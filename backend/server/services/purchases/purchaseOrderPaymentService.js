const mongoose = require('mongoose');
const PurchaseOrder = require('../../models/vendor/purchaseOrder');
const Payment = require('../../models/vendor/paymentModel');
const JournalEntry = require('../../models/accounting/journalEntryModel');
const ApiError = require('../../utils/apiError');
const { round2 } = require('../../utils/orderTotals');

// A Purchase Order's payment position, from its payments and their journal entries:
//
//   Subtotal before tax  = Σ items (after discounts, net of returns)      totalAmount
//   Total PO amount      = subtotal + VAT - withholding tax                grandTotal (what is owed
//                          to the vendor - withholding is paid to the Tax Authority instead)
//   Total paid           = payments to the vendor that still count (their entry not reversed),
//                          + an Advanced Payment applied when the order was created,
//                          - refunds received back on returns
//   Outstanding payable  = total - paid, when positive; a negative difference is a credit balance
//
// In Reservia a payment always belongs to exactly one order, so the amount allocated to the order is
// the payment's amount; there are no unapplied payments. Status: unpaid / partially paid / paid /
// overpaid (credit balance).

const EPS = 0.005;
const statusOf = (paid, total) => (paid <= EPS ? 'unpaid' : paid < total - EPS ? 'partially_paid' : paid > total + EPS ? 'overpaid' : 'paid');

async function purchaseOrderPayments(purchaseOrderId) {
  if (!mongoose.Types.ObjectId.isValid(String(purchaseOrderId))) throw new ApiError('Invalid purchase order id', 400);
  const po = await PurchaseOrder.findById(purchaseOrderId).lean();
  if (!po) throw new ApiError('Purchase Order not found', 404);
  const payments = await Payment.find({ purchaseOrderId: po._id }).sort({ createdAt: 1 }).lean();
  const [paymentEntries, advanceEntry] = await Promise.all([
    JournalEntry.collection.find({ sourceType: 'PAYMENT', sourceId: { $in: payments.map(p => p._id) } }, { projection: { entryNumber: 1, status: 1, sourceId: 1, accountingAction: 1, reversedByEntry: 1 } }).toArray(),
    JournalEntry.collection.findOne({ sourceType: 'PO', sourceId: po._id, accountingAction: 'PO_SUPPLIER_ADVANCE_APPLIED' }, { projection: { entryNumber: 1, status: 1, totalDebit: 1, date: 1, reversedByEntry: 1 } }),
  ]);
  const reversalIds = [...paymentEntries, advanceEntry].filter(e => e?.reversedByEntry).map(e => e.reversedByEntry);
  const reversals = reversalIds.length ? await JournalEntry.collection.find({ _id: { $in: reversalIds } }, { projection: { entryNumber: 1, date: 1 } }).toArray() : [];
  const reversalOf = id => reversals.find(r => String(r._id) === String(id)) || null;
  const entryOf = new Map(paymentEntries.map(e => [String(e.sourceId), e]));

  const rows = payments.map(p => {
    const entry = entryOf.get(String(p._id));
    const reversed = !!p.reversedByEntry || entry?.status === 'reversed';
    const kind = p.type === 'in' ? 'refund' : p.advancedPayment ? 'advance' : 'payment';
    const reversal = entry?.reversedByEntry ? reversalOf(entry.reversedByEntry) : null;
    return {
      _id: p._id,
      date: p.createdAt,
      reference: p.notes || null,
      kind,
      method: p.paymentAccount ? 'account' : p.advancedPayment ? 'advanced_payment' : p.paymentMethod || null,
      paymentMethod: p.paymentMethod || null,
      paymentAccount: p.paymentAccount || null,
      currency: 'EGP',
      amount: round2(p.amountPaid || 0),
      allocated: round2(p.amountPaid || 0),
      status: reversed ? 'reversed' : entry ? 'posted' : 'recorded',
      journalEntry: entry ? { _id: entry._id, entryNumber: entry.entryNumber } : null,
      reversalEntry: reversal ? { _id: reversal._id, entryNumber: reversal.entryNumber, date: reversal.date } : null,
      createdBy: p.createdBy || null,
    };
  });
  if (advanceEntry) {
    const reversal = advanceEntry.reversedByEntry ? reversalOf(advanceEntry.reversedByEntry) : null;
    rows.unshift({
      _id: String(advanceEntry._id),
      date: advanceEntry.date,
      reference: 'Advanced Payment applied on creation',
      kind: 'advance',
      method: 'advanced_payment',
      paymentMethod: null,
      paymentAccount: null,
      currency: 'EGP',
      amount: round2(advanceEntry.totalDebit || 0),
      allocated: round2(advanceEntry.totalDebit || 0),
      status: advanceEntry.status === 'reversed' ? 'reversed' : 'posted',
      journalEntry: { _id: advanceEntry._id, entryNumber: advanceEntry.entryNumber },
      reversalEntry: reversal ? { _id: reversal._id, entryNumber: reversal.entryNumber, date: reversal.date } : null,
      createdBy: null,
    });
  }

  const counted = rows.filter(r => r.status !== 'reversed');
  const paid = round2(counted.filter(r => r.kind !== 'refund').reduce((s, r) => s + r.allocated, 0));
  const refunded = round2(counted.filter(r => r.kind === 'refund').reduce((s, r) => s + r.allocated, 0));
  const totalPaid = round2(paid - refunded);
  const total = round2(po.grandTotal ?? po.totalAmount ?? 0);
  const difference = round2(total - totalPaid);
  const discount = round2((po.items || []).reduce((s, i) => s + ((i.unitPrice || 0) - (i.unitPriceAfterDiscount ?? i.unitPrice ?? 0)) * (i.starterQuantity || 0), 0));
  const returned = round2((po.starterTotalAmount ?? po.totalAmount ?? 0) - (po.totalAmount ?? 0));

  return {
    summary: {
      grossBeforeDiscount: round2((po.items || []).reduce((s, i) => s + (i.unitPrice || 0) * (i.starterQuantity || 0), 0)),
      discounts: discount,
      returns: returned,
      subtotal: round2(po.totalAmount ?? 0),
      vatPercentage: po.vatPercentage || 0,
      vat: round2(po.vatAmount || 0),
      withholdingPercentage: po.withholdingTaxPercentage || 0,
      withholding: round2(po.withholdingTaxAmount || 0),
      total,
      totalPaid,
      paidBeforeRefunds: paid,
      refunded,
      outstanding: difference > EPS ? difference : 0,
      creditBalance: difference < -EPS ? -difference : 0,
      unappliedPayments: 0,
      status: statusOf(totalPaid, total),
      // The order's stored paid amount, when it differs (e.g. a payment reversed before reversals
      // updated the order) - shown so the difference is visible, never hidden.
      storedPaidAmount: round2(po.paidAmount || 0),
      storedStatus: po.paymentStatus || null,
      currency: 'EGP',
    },
    payments: rows.sort((a, b) => new Date(b.date) - new Date(a.date)),
  };
}

module.exports = { purchaseOrderPayments, statusOf };
