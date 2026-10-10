const Payment = require('../../models/vendor/paymentModel');
const PurchaseOrder = require('../../models/vendor/purchaseOrder');
const Expense = require('../../models/expense/expenseModel');
const Vendor = require('../../models/vendor/vendor');
const Warehouse = require('../../models/inventory/warehouseModel');
const { round2 } = require('../../utils/orderTotals');

// When the journal entry of a vendor payment is reversed (the standard journal entry reversal), the
// payment no longer happened in the ledger - so the documents that recorded it must stop counting it
// too, in the same transaction: the Purchase Order's or Expense's paid amount (and so its status),
// the vendor's balance due and the warehouse cash balance the payment had moved. The Payment record
// itself is kept, marked reversed, for the audit trail. A payment is only ever reversed once.
// (Fixed asset payments are derived from their entries already - only the balances apply to them.)

const PAYMENT_ACTIONS = ['PO_PAYMENT_RECORDED', 'PAYMENT_VENDOR_ADVANCE_APPLIED', 'EXPENSE_PAYMENT_RECORDED', 'FIXED_ASSET_PAYMENT_RECORDED'];

async function applyPaymentReversal(originalEntry, reversalEntry, session) {
  if (!PAYMENT_ACTIONS.includes(originalEntry.accountingAction) || originalEntry.sourceType !== 'PAYMENT' || !originalEntry.sourceId) return null;
  // Claim the payment first - a concurrent or repeated call finds it already reversed and stops.
  const payment = await Payment.collection.findOneAndUpdate(
    { _id: originalEntry.sourceId, reversedByEntry: null },
    { $set: { reversedByEntry: reversalEntry._id, reversedAt: new Date() } },
    { session, returnDocument: 'before' }
  );
  const doc = payment?.value !== undefined ? payment.value : payment;
  if (!doc) return null;
  const amount = round2(doc.amountPaid || 0);
  const sign = doc.type === 'in' ? -1 : 1; // an 'out' payment is undone by adding it back

  if (doc.purchaseOrderId) {
    const po = await PurchaseOrder.findById(doc.purchaseOrderId).session(session);
    if (po) {
      po.paidAmount = round2(Math.max(0, (po.paidAmount || 0) - sign * amount));
      await po.save({ session }); // recomputes remainingAmount and paymentStatus
    }
  }
  if (originalEntry.accountingAction === 'EXPENSE_PAYMENT_RECORDED') {
    const expense = await Expense.findOne({ 'payments.payment': doc._id }).session(session);
    if (expense) {
      const paidAmount = round2(Math.max(0, (expense.paidAmount || 0) - amount));
      await Expense.updateOne(
        { _id: expense._id, 'payments.payment': doc._id },
        { $set: { paidAmount, paymentStatus: paidAmount <= 0 ? 'unpaid' : paidAmount >= expense.totalAmount ? 'paid' : 'partially_paid', 'payments.$.reversedByEntry': reversalEntry._id } },
        { session }
      );
    }
  }
  if (doc.vendorId) await Vendor.updateOne({ _id: doc.vendorId }, { $inc: { balance: sign * amount } }, { session });
  if (doc.warehouseId) await Warehouse.updateOne({ _id: doc.warehouseId }, { $inc: { balance: sign * amount } }, { session });
  return { payment: doc._id, amount };
}

module.exports = { applyPaymentReversal, PAYMENT_ACTIONS };
