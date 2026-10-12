const Payment = require('../../models/vendor/paymentModel');
const PurchaseOrder = require('../../models/vendor/purchaseOrder');
const SalesOrder = require('../../models/sales/salesOrderModel');
const Expense = require('../../models/expense/expenseModel');
const Vendor = require('../../models/vendor/vendor');
const User = require('../../models/userModel');
const Warehouse = require('../../models/inventory/warehouseModel');
const AdvancedPayment = require('../../models/payments/advancedPaymentModel');
const { round2 } = require('../../utils/orderTotals');

// When a payment is reversed - by reversing its journal entry (Journal Entries -> Reverse) or from
// the payment itself (services/accounting/reversalService.js#reversePayment / #reverseSettlement) -
// the payment no longer happened, so every document it moved must stop counting it, in the same
// transaction: the Purchase / Sales Order's paid amount (and so its outstanding amount and payment
// status), the Expense's paid amount, the vendor / customer balance, the warehouse cash balance and,
// for a payment funded from an Advanced Payment, the advance's balance and usage entry. The Payment
// record itself is kept, marked reversed, for the audit trail. A payment is only ever reversed once.
// (Fixed asset payments are derived from their entries already - only the balances apply to them.)

// Every automatic entry a Payment document posts (sourceType 'PAYMENT').
const PAYMENT_ACTIONS = [
  'PO_PAYMENT_RECORDED',
  'PAYMENT_VENDOR_ADVANCE_APPLIED',
  'EXPENSE_PAYMENT_RECORDED',
  'FIXED_ASSET_PAYMENT_RECORDED',
  'SO_PAYMENT_RECORDED',
  'PAYMENT_CUSTOMER_ADVANCE_APPLIED',
  'SO_REFUND_RECORDED',
  'PO_REFUND_RECORDED',
];

/** Gives a payment's consumed advance back (its usage entry is kept, marked reversed). */
async function restoreAdvanceUsedByPayment(doc, session) {
  if (!doc.advancedPayment) return null;
  const advance = await AdvancedPayment.findById(doc.advancedPayment).session(session);
  if (!advance) return null;
  const entry = advance.usageHistory.find(u => String(u.payment?._id || u.payment || '') === String(doc._id) && !u.reversed);
  if (!entry) return null;
  entry.reversed = true;
  entry.note = entry.note || 'Payment reversed';
  advance.remainingAmount = round2(Math.min(advance.amount, advance.remainingAmount + entry.amountConsumed));
  await advance.save({ session }); // recomputes the advance's status
  return { advancedPayment: advance._id, restored: entry.amountConsumed };
}

/**
 * Claims the payment (only one reversal can ever claim it) and undoes everything it moved. Returns
 * null when it was already reversed. `reversalEntryId` is null for a legacy payment that never had a
 * journal entry.
 */
async function claimAndApplyPaymentReversal(paymentId, { reversalEntryId = null, reason = null, userId = null } = {}, session) {
  const result = await Payment.collection.findOneAndUpdate(
    { _id: paymentId, reversedByEntry: null, reversedAt: null },
    { $set: { reversedByEntry: reversalEntryId, reversedAt: new Date(), reversalReason: reason, reversedBy: userId } },
    { session, returnDocument: 'before' }
  );
  const doc = result?.value !== undefined ? result.value : result;
  if (!doc) return null;
  const amount = round2(doc.amountPaid || 0);
  // An 'out' payment is undone by adding it back, an 'in' payment by taking it away again (the
  // exact opposite of what models/vendor/paymentModel.js's pre('save') did when it was recorded).
  const sign = doc.type === 'in' ? -1 : 1;

  if (doc.purchaseOrderId) {
    const po = await PurchaseOrder.findById(doc.purchaseOrderId).session(session);
    if (po) {
      po.paidAmount = round2(Math.max(0, (po.paidAmount || 0) - sign * amount));
      await po.save({ session }); // recomputes remainingAmount and paymentStatus
    }
  }
  if (doc.salesOrderId) {
    const so = await SalesOrder.findById(doc.salesOrderId).session(session);
    if (so) {
      so.paidAmount = round2(Math.max(0, (so.paidAmount || 0) + sign * amount));
      await so.save({ session }); // recomputes remainingAmount and paymentStatus
    }
  }
  const expense = await Expense.findOne({ 'payments.payment': doc._id }).session(session);
  if (expense) {
    const paidAmount = round2(Math.max(0, (expense.paidAmount || 0) - amount));
    await Expense.updateOne(
      { _id: expense._id, 'payments.payment': doc._id },
      { $set: { paidAmount, paymentStatus: paidAmount <= 0 ? 'unpaid' : paidAmount >= expense.totalAmount ? 'paid' : 'partially_paid', 'payments.$.reversedByEntry': reversalEntryId } },
      { session }
    );
  }
  if (doc.vendorId) await Vendor.updateOne({ _id: doc.vendorId }, { $inc: { balance: sign * amount } }, { session });
  if (doc.customerId) await User.updateOne({ _id: doc.customerId }, { $inc: { balance: sign * amount } }, { session });
  if (doc.warehouseId) await Warehouse.updateOne({ _id: doc.warehouseId }, { $inc: { balance: sign * amount } }, { session });
  const advance = await restoreAdvanceUsedByPayment(doc, session);
  return { payment: doc._id, amount, advance, doc };
}

/** Journal Entries -> Reverse of a payment's own entry: the same document effects. */
async function applyPaymentReversal(originalEntry, reversalEntry, session) {
  if (!PAYMENT_ACTIONS.includes(originalEntry.accountingAction) || originalEntry.sourceType !== 'PAYMENT' || !originalEntry.sourceId) return null;
  return claimAndApplyPaymentReversal(originalEntry.sourceId, { reversalEntryId: reversalEntry._id, userId: reversalEntry.createdBy || null }, session);
}

module.exports = { applyPaymentReversal, claimAndApplyPaymentReversal, restoreAdvanceUsedByPayment, PAYMENT_ACTIONS };
