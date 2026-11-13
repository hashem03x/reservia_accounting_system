const mongoose = require('mongoose');
const SalesOrder = require('../../models/sales/salesOrderModel');
const Product = require('../../models/inventory/productModel');
const Project = require('../../models/project/projectModel');
const ApiError = require('../../utils/apiError');
const { consumeCustomerAdvancedPayment } = require('../payments/advancedPaymentService');
const { recalculateExecutedPercentage } = require('../project/projectAccountingService');
const { postSalesOrderAdvanceAppliedJE } = require('../accounting/accountingEventService');
const { consumePucForSale } = require('../inventory/pucSalesConsumptionService');
const { assertProjectStock } = require('../inventory/projectStockService');
const { stepTimer } = require('../../utils/stepTimer');

// Every new Sales Order requires a project (salesOrderModel.js's pre('save') hook), and a
// project's materials are purchased straight into its PUC, never left sitting as ordinary
// warehouse stock (every Purchase Order with a project - always - is synchronously, fully
// allocated to that project's PUC on receipt: poProjectAllocationService.js). So a sale's
// materials/cost must come from the sold product's PROJECT's PUC balance
// (pucSalesConsumptionService.js#consumePucForSale, called from createSalesOrder below), never
// from Product.stock - decrementing stock here on top of that would incorrectly treat project
// materials as available warehouse inventory a second time (they were never really there as
// general stock to begin with). `totalSold` (a lifetime sales counter, unrelated to on-hand
// quantity) is still incremented exactly as before.
async function updateStockAndSold(item, warehouseId, session) {
  const { product: productId, starterQuantity } = item;

  const result = await Product.findByIdAndUpdate(productId, { $inc: { totalSold: starterQuantity } }, { new: true, session, runValidators: true });
  if (!result) throw new ApiError(`Product with ID ${productId} not found.`);
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
    vatExemptReason,
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

  // ERP CHG-05: one timing log line per save, step by step.
  const timer = stepTimer('sales_invoice');
  const ownsSession = !providedSession;
  const session = providedSession || (await mongoose.startSession());
  let salesOrder;

  const run = async () => {
    // ERP CHG-03: a line above the project's stock is refused here, on the server, before anything
    // is written (the form shows the available quantity, but the rule never depends on it).
    if (project) await assertProjectStock({ projectId: project, items });
    timer.mark('stockCheck');

    const validItems = [];
    for (const item of items) {
      const updatedProduct = await updateStockAndSold(item, resolvedWarehouse, session);
      if (!updatedProduct) throw new ApiError(`Product not found for item ${item.product}`);
      validItems.push({ ...item, costWhenSold: updatedProduct.cost });
    }

    timer.mark('products');
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
      // ERP CHG-06: why a 0% invoice carries no VAT (required by the create request validator).
      ...(vatExemptReason ? { vatExemptReason } : {}),
      ...(withholdingTaxPercentage !== undefined ? { withholdingTaxPercentage } : {}),
      ...extraFields,
    });

    // Advanced Payment: the server NEVER trusts a client-submitted amount (docs section "Do not
    // trust the frontend amount") - `paidAmount` above is discarded/overridden entirely here. This
    // must run inside the same transaction as the SalesOrder save below: either both the advance
    // consumption and the order creation commit together, or neither does (docs section "Atomic
    // database operation").
    let consumedAdvanceAmount = null;
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
      consumedAdvanceAmount = consumedAmount;
    }

    await salesOrder.save({ session });
    timer.mark('validateAndSave');

    // Automatic accounting engine (SO_CUSTOMER_ADVANCE_APPLIED / JV012 part A) - this was
    // previously never called from this flow despite the function existing, meaning a Sales Order
    // paid via Advanced Payment silently produced NO automatic Journal Entry at all (docs section
    // "Do not approximate these entries... An event may trigger multiple automatic Journal
    // Entries") - fixed here, mirroring purchaseOrderController.js's identical call for the
    // vendor-side equivalent.
    if (consumedAdvanceAmount !== null) {
      await postSalesOrderAdvanceAppliedJE(salesOrder, consumedAdvanceAmount, session);
    }

    // Consumes this order's materials from its project's PUC balance (Dr COGS / Cr PUC - Raw
    // Materials) - BEFORE recalculateExecutedPercentage below, so PROJECT_COST_RECOGNITION's own
    // real-PUC-balance cap (accountingEventService.js#pucAccountBalance) already sees what this
    // just consumed and never double-counts it.
    if (salesOrder.project) {
      await consumePucForSale(salesOrder, { userId: createdBy, session });
    }
    timer.mark('costOfSalesJournal');

    // Project is mandatory for every new Sales Order (see salesOrderModel.js's pre('save') hook),
    // so this always runs - recomputes Executed % for the project this order's amount now counts
    // toward (docs section "Project Executed % Calculation").
    if (salesOrder.project) {
      await recalculateExecutedPercentage(salesOrder.project._id || salesOrder.project, session, salesOrder._id);
    }
    timer.mark('revenueAndExecutedPct');
  };

  let ok = false;
  try {
    if (ownsSession) {
      await session.withTransaction(run);
    } else {
      await run();
    }
    ok = true;
  } finally {
    if (ownsSession) session.endSession();
    timer.mark('commit');
    timer.done({ ok, code: salesOrder?.code || null });
  }

  return salesOrder;
}

module.exports = { createSalesOrder };
