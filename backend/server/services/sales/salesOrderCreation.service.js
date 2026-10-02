const mongoose = require('mongoose');
const SalesOrder = require('../../models/sales/salesOrderModel');
const Product = require('../../models/inventory/productModel');
const ApiError = require('../../utils/apiError');

// Decrements this product's stock in the sale's warehouse AND increments its totalSold in one
// atomic update - previously two separate writes (decrement Variant.stock, then a second
// Product.findByIdAndUpdate for totalSold once the variant's productId was resolved). With items
// identifying their product directly, there's no variant to resolve and no reason for a second
// write.
async function updateStockAndSold(item, warehouseId, session) {
  const { product: productId, starterQuantity } = item;

  // Products are the overwhelmingly common case, so try the warehouse-stock decrement first (one
  // query) exactly as before - this only ever misses for a service (no stock array to match) or a
  // genuinely missing product, both handled in the fallback below without adding a query to the
  // normal product path.
  const result = await Product.findOneAndUpdate(
    { _id: productId, 'stock.warehouse': warehouseId },
    { $inc: { 'stock.$.quantity': -starterQuantity, totalSold: starterQuantity } },
    { new: true, session, runValidators: true }
  );

  if (!result) {
    const foundProduct = await Product.findById(productId).session(session);
    if (!foundProduct) throw new ApiError(`Product with ID ${productId} not found.`);

    // A service has no stock/warehouse concept at all (see docs/entities/products.md) - selling
    // one only needs totalSold tracked for reporting, there is nothing to decrement.
    if (foundProduct.type === 'service') {
      return Product.findByIdAndUpdate(productId, { $inc: { totalSold: starterQuantity } }, { new: true, session, runValidators: true });
    }

    const stock = foundProduct.stock.find(s => s.warehouse.toString() === warehouseId);
    if (!stock) throw new ApiError(`No stock found for product ${foundProduct.title?.en || foundProduct.sku || productId} in warehouse ${warehouseId}`);
  }

  return result;
}

/**
 * Core "decrement stock, accumulate totalSold, create the SalesOrder" transaction for the
 * cashier/POS HTTP endpoint (controller/sales/salesOrderController.js#createCashierSalesOrder).
 *
 * `session`: pass an existing transaction session to participate in a larger transaction; omit
 * to have this function manage its own transaction end-to-end (the HTTP cashier endpoint's
 * original behavior).
 */
async function createSalesOrder(
  { customer, warehouse, items, isPrepaid, shippingCost, isCodOrder, paidAmount, createdBy, employee, extraFields = {} },
  { session: providedSession } = {}
) {
  if (!items || !Array.isArray(items) || items.length === 0) throw new ApiError('Items must be a non-empty array');

  const resolvedOrderSource = 'cashier';
  const resolvedWarehouse = warehouse;

  const ownsSession = !providedSession;
  const session = providedSession || (await mongoose.startSession());
  let salesOrder;

  const run = async () => {
    const validItems = [];
    for (const item of items) {
      const updatedProduct = await updateStockAndSold(item, resolvedWarehouse, session);
      if (!updatedProduct) throw new ApiError(`Product not found for item ${item.product}`);
      validItems.push({ ...item, costWhenSold: updatedProduct.cost });
    }

    salesOrder = new SalesOrder({
      warehouse: resolvedWarehouse,
      customer,
      isPrepaid,
      orderSource: resolvedOrderSource,
      items: validItems,
      createdBy,
      employee,
      shippingCost,
      ...(isCodOrder !== undefined ? { isCodOrder } : {}),
      ...(paidAmount !== undefined ? { paidAmount } : {}),
      ...extraFields,
    });

    await salesOrder.save({ session });
  };

  try {
    if (ownsSession) {
      await session.withTransaction(run);
    } else {
      await run();
    }
  } finally {
    if (ownsSession) session.endSession();
  }

  return salesOrder;
}

module.exports = { createSalesOrder };
