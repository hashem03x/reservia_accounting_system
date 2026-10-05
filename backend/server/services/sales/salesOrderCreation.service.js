const mongoose = require('mongoose');
const SalesOrder = require('../../models/sales/salesOrderModel');
const Product = require('../../models/inventory/productModel');
const Project = require('../../models/project/projectModel');
const ApiError = require('../../utils/apiError');
const { consumeCustomerAdvancedPayment } = require('../payments/advancedPaymentService');
const { recalculateExecutedPercentage } = require('../project/projectAccountingService');

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
  {
    customer,
    warehouse,
    items,
    isPrepaid,
    shippingCost,
    isCodOrder,
    paidAmount,
    paymentMethod,
    paymentAccount,
    project,
    vatPercentage,
    withholdingTaxPercentage,
    createdBy,
    employee,
    extraFields = {},
  },
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
      ...(paymentMethod !== undefined ? { paymentMethod } : {}),
      ...(paymentAccount !== undefined ? { paymentAccount } : {}),
      ...(project !== undefined ? { project } : {}),
      ...(vatPercentage !== undefined ? { vatPercentage } : {}),
      ...(withholdingTaxPercentage !== undefined ? { withholdingTaxPercentage } : {}),
      ...extraFields,
    });

    // Advanced Payment: the server NEVER trusts a client-submitted amount (docs section "Do not
    // trust the frontend amount") - `paidAmount` above is discarded/overridden entirely here. This
    // must run inside the same transaction as the SalesOrder save below: either both the advance
    // consumption and the order creation commit together, or neither does (docs section "Atomic
    // database operation").
    if (paymentMethod === 'advanced_payment') {
      if (!project) throw new ApiError('A project must be selected to use Advanced Payment.', 400);

      const projectDoc = await Project.findById(project).session(session);
      if (!projectDoc) throw new ApiError('Project not found.', 404);
      // Project.findById() runs Project's own populate hook, turning `.customer` into
      // `{_id, name, ...}` - see advancedPaymentModel.js's identical comment.
      const projectCustomerId = projectDoc.customer?._id || projectDoc.customer;
      if (!projectCustomerId || projectCustomerId.toString() !== String(customer)) {
        throw new ApiError('This project does not belong to the selected customer.', 400);
      }

      // `salesOrder._id` already exists at this point - Mongoose generates ObjectIds client-side on
      // construction, not on insert - so the usage-history entry can reference the real order id in
      // a single pass, with no separate patch-after-save step.
      const { advancedPaymentId, consumedAmount } = await consumeCustomerAdvancedPayment({
        customer,
        project,
        salesOrderId: salesOrder._id,
        session,
      });

      salesOrder.paidAmount = consumedAmount;
      salesOrder.advancedPayment = advancedPaymentId;
    }

    await salesOrder.save({ session });

    // Project is mandatory for every new Sales Order (see salesOrderModel.js's pre('save') hook),
    // so this always runs - recomputes Executed % for the project this order's amount now counts
    // toward (docs section "Project Executed % Calculation").
    if (salesOrder.project) {
      await recalculateExecutedPercentage(salesOrder.project._id || salesOrder.project, session);
    }
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
