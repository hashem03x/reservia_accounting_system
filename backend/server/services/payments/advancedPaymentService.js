const ApiError = require('../../utils/apiError');

// Consumption/restoration of Advanced Payments - kept in one service rather than inline in the
// Sales Order controller/service, so Purchase Orders (vendor-side consumption, see docs section
// "Vendor Advanced Payments") can reuse the same logic later instead of duplicating it.

/**
 * The single, currently-available Customer Advanced Payment for a given customer+project, or null.
 * Read-only - does not consume anything. This is what the Sales Order creation UI calls to show
 * "Available Advanced Payment: X" before the order is actually submitted.
 */
async function getAvailableCustomerAdvancedPayment(customerId, projectId, session) {
  const AdvancedPayment = require('../../models/payments/advancedPaymentModel'); // eslint-disable-line global-require

  let query = AdvancedPayment.findOne({
    type: 'customer',
    customer: customerId,
    project: projectId,
    status: { $ne: 'cancelled' },
    remainingAmount: { $gt: 0 },
  }).sort({ createdAt: 1 }); // oldest first (FIFO) - matches every example in the spec, which only ever shows one advance per customer+project.

  if (session) query = query.session(session);
  return query;
}

/**
 * Atomically consumes the ENTIRE remaining balance of the oldest available Customer Advanced
 * Payment for (customer, project), recording the consumption against `salesOrderId`. Must be
 * called inside an active `session.withTransaction(...)` callback alongside the Sales Order write -
 * MongoDB's transaction-level write-conflict detection is what actually prevents double-spending
 * two concurrent requests both reading the same "available" balance (see
 * journalEntryController.js#reverseJournalEntry for the same re-fetch-inside-transaction
 * convention this mirrors): if two transactions both touch this same AdvancedPayment document, the
 * second to commit is aborted and retried by `withTransaction`'s built-in retry logic, re-reading
 * on retry and correctly finding nothing left to consume.
 *
 * Throws ApiError (never silently returns null) if nothing is available, so the caller's
 * transaction aborts and no Sales Order is created - see docs section "Do not trust the frontend
 * amount".
 *
 * @returns {Promise<{ advancedPaymentId: ObjectId, consumedAmount: number }>}
 */
async function consumeCustomerAdvancedPayment({ customer, project, salesOrderId, session }) {
  const advance = await getAvailableCustomerAdvancedPayment(customer, project, session);
  if (!advance) {
    throw new ApiError('No available advanced payment exists for this project.', 400);
  }

  const consumedAmount = advance.remainingAmount;
  advance.remainingAmount = 0;
  advance.usageHistory.push({ salesOrder: salesOrderId, amountConsumed: consumedAmount, date: new Date() });
  await advance.save({ session });

  return { advancedPaymentId: advance._id, consumedAmount };
}

/**
 * Reverses a specific Sales Order's consumption of an Advanced Payment (docs section "Sales Order
 * edit/cancel/return") - restores the consumed amount back onto the SAME AdvancedPayment document
 * and marks that usage entry `reversed: true` (the entry itself is kept, never deleted, so the
 * audit trail still shows the original consumption happened). No-ops cleanly if the order never
 * used an advance, or if it was already reversed - safe to call unconditionally from cancelOrder.
 */
async function restoreAdvancedPaymentForSalesOrder({ advancedPaymentId, salesOrderId, session }) {
  if (!advancedPaymentId) return;

  const AdvancedPayment = require('../../models/payments/advancedPaymentModel'); // eslint-disable-line global-require
  const advance = await AdvancedPayment.findById(advancedPaymentId).session(session || null);
  if (!advance) return;

  // AdvancedPayment.findById() runs this schema's own pre(/^find/) hook, which populates
  // `usageHistory.salesOrder` into a full SalesOrder document - comparing `.toString()` directly
  // on that would always mismatch (see advancedPaymentModel.js's identical comment re: `project`).
  const entry = advance.usageHistory.find(u => {
    const uSalesOrderId = u.salesOrder?._id || u.salesOrder;
    return uSalesOrderId && uSalesOrderId.toString() === String(salesOrderId) && !u.reversed;
  });
  if (!entry) return;

  entry.reversed = true;
  advance.remainingAmount = Math.min(advance.amount, advance.remainingAmount + entry.amountConsumed);
  await advance.save({ session });
}

module.exports = { getAvailableCustomerAdvancedPayment, consumeCustomerAdvancedPayment, restoreAdvancedPaymentForSalesOrder };
