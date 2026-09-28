const mongoose = require('mongoose');
const SalesOrder = require('../../models/sales/salesOrderModel');
const Variant = require('../../models/inventory/variantModel');
const Product = require('../../models/inventory/productModel');
const ApiError = require('../../utils/apiError');

async function updateStock(item, warehouseId, session) {
  const { variant, starterQuantity } = item;

  const result = await Variant.findOneAndUpdate(
    { _id: variant, 'stock.warehouse': warehouseId },
    { $inc: { 'stock.$.quantity': -starterQuantity } },
    { new: true, session, runValidators: true }
  );

  if (!result) {
    const foundVariant = await Variant.findById(variant).session(session);
    if (!foundVariant) throw new ApiError(`Variant with ID ${variant} not found.`);
    const stock = foundVariant.stock.find(s => s.warehouse.toString() === warehouseId);
    if (!stock) throw new ApiError(`No stock found for variant ${foundVariant.variantCode} in warehouse ${warehouseId}`);
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
      const updatedVariant = await updateStock(item, resolvedWarehouse, session);
      const product = await Product.findByIdAndUpdate(updatedVariant.productId, { $inc: { totalSold: item.starterQuantity } }, { new: true, session });
      if (!product) throw new ApiError(`Product not found for variant ${item.variant}`);
      validItems.push({ ...item, costWhenSold: product.cost });
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
