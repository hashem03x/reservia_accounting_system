const mongoose = require('mongoose');
const Expense = require('../../models/expense/expenseModel');
const JournalEntry = require('../../models/accounting/journalEntryModel');
const ApiError = require('../../utils/apiError');
const { round2 } = require('../../utils/orderTotals');

// A vendor's expenses (Expense.vendor - the reference every vendor expense already carries, set and
// validated when the expense is created), for the vendor's page. Recognition and payment are kept
// apart: the expense is recognized by its EXPENSE_RECORDED entry; it is paid by its payments, and a
// payment whose entry was reversed does not count. An expense whose own entry was reversed is shown as
// cancelled and left out of the totals. Legacy cash expenses (no vendor) never appear here.

const EPS = 0.005;
const STATUSES = ['unpaid', 'partially_paid', 'paid', 'cancelled'];

async function vendorExpenses(vendorId, { from, to, status } = {}) {
  if (!mongoose.Types.ObjectId.isValid(String(vendorId))) throw new ApiError('Invalid vendor id', 400);
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if ((from && !day.test(from)) || (to && !day.test(to))) throw new ApiError('Dates must be in YYYY-MM-DD format.', 400);
  if (status && !STATUSES.includes(status)) throw new ApiError('Invalid payment status.', 400);

  const filter = { vendor: new mongoose.Types.ObjectId(String(vendorId)) };
  if (from || to) filter.date = { ...(from ? { $gte: new Date(`${from}T00:00:00.000Z`) } : {}), ...(to ? { $lte: new Date(`${to}T23:59:59.999Z`) } : {}) };
  const expenses = await Expense.find(filter).sort({ date: -1, createdAt: -1 }).lean();
  const entryIds = expenses.flatMap(e => [e.journalEntry, ...(e.payments || []).map(p => p.journalEntry)]).filter(Boolean);
  const entries = entryIds.length ? await JournalEntry.collection.find({ _id: { $in: entryIds } }, { projection: { entryNumber: 1, status: 1 } }).toArray() : [];
  const entryOf = new Map(entries.map(e => [String(e._id), e]));

  let rows = expenses.map(e => {
    const entry = e.journalEntry ? entryOf.get(String(e.journalEntry)) : null;
    const cancelled = entry?.status === 'reversed';
    const livePayments = (e.payments || []).filter(p => !p.reversedByEntry && entryOf.get(String(p.journalEntry))?.status !== 'reversed');
    const paid = round2(livePayments.reduce((s, p) => s + (p.amount || 0), 0));
    const total = round2(e.totalAmount ?? (e.amount || 0) + (e.vatAmount || 0));
    const outstanding = cancelled ? 0 : round2(Math.max(0, total - paid));
    const paymentStatus = cancelled ? 'cancelled' : paid <= EPS ? 'unpaid' : outstanding > EPS ? 'partially_paid' : 'paid';
    return {
      _id: e._id,
      date: e.date || e.createdAt,
      reference: e.reference || null,
      category: e.category ? { _id: e.category._id, name: e.category.name, nameAr: e.category.nameAr || null } : null,
      expenseAccount: e.expenseAccount ? { code: e.expenseAccount.code, name: e.expenseAccount.name } : null,
      description: e.notes || null,
      projectNumber: null, // vendor expenses are not linked to a project
      currency: 'EGP',
      amount: round2(e.amount || 0),
      vat: round2(e.vatAmount || 0),
      total,
      paid,
      outstanding,
      paymentStatus,
      journalEntry: entry ? { _id: entry._id, entryNumber: entry.entryNumber, status: entry.status } : null,
      payments: (e.payments || []).map(p => ({ date: p.date, amount: p.amount, reversed: !!p.reversedByEntry || entryOf.get(String(p.journalEntry))?.status === 'reversed', journalEntry: entryOf.get(String(p.journalEntry)) ? { _id: p.journalEntry, entryNumber: entryOf.get(String(p.journalEntry)).entryNumber } : null })),
    };
  });
  if (status) rows = rows.filter(r => r.paymentStatus === status);
  const counted = rows.filter(r => r.paymentStatus !== 'cancelled');
  const sum = key => round2(counted.reduce((s, r) => s + r[key], 0));
  return {
    totals: { count: counted.length, amount: sum('amount'), vat: sum('vat'), total: sum('total'), paid: sum('paid'), outstanding: sum('outstanding'), cancelled: rows.length - counted.length },
    expenses: rows,
  };
}

module.exports = { vendorExpenses, STATUSES };
