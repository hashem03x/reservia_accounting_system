const mongoose = require('mongoose');
const JournalEntry = require('../../models/accounting/journalEntryModel');
const ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
const ApiError = require('../../utils/apiError');
const { sortByAccountCode } = require('../../utils/accountCodeSort');

// Shared foundation of the accounting reports (services/reports/*). Read-only: nothing here ever
// creates, updates or deletes a document.
//
// LEDGER: an entry is part of the ledger once it has been posted. Reversing a posted entry marks
// the ORIGINAL 'reversed' and posts a mirror entry ('posted', reversalOfEntry) - both are real
// postings, and together they net to zero. So the reports count status 'posted' AND 'reversed';
// drafts never count.
const LEDGER_STATUSES = ['posted', 'reversed'];

// Natural (normal) balance side per account type - used to present balances as positive amounts.
const DEBIT_NATURE_TYPES = new Set(['asset', 'expense', 'cogs']);
const PROFIT_AND_LOSS_TYPES = new Set(['revenue', 'expense', 'cogs']);

const round2 = n => Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100;
const pct = (part, whole) => (whole ? round2((part / whole) * 100) : null);
const idOf = ref => (ref?._id || ref ? String(ref?._id || ref) : null);

// ---------------------------------------------------------------- dates
// Reporting days are UTC calendar days (the server's - and production's - day), given as
// 'YYYY-MM-DD'. A period covers [from 00:00:00.000Z, to 23:59:59.999Z].
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseDay(value, name) {
  if (!DATE_PATTERN.test(String(value || ''))) throw new ApiError(`${name} must be a date in YYYY-MM-DD format.`, 400);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new ApiError(`${name} is not a valid date.`, 400);
  return date;
}
const dayStart = day => new Date(`${day}T00:00:00.000Z`);
const dayEnd = day => new Date(`${day}T23:59:59.999Z`);
const today = () => new Date().toISOString().slice(0, 10);

/** { from, to, start, end } - defaults to the current year to date. */
function resolvePeriod(query = {}) {
  const to = query.to || today();
  const from = query.from || `${to.slice(0, 4)}-01-01`;
  parseDay(from, 'Start date');
  parseDay(to, 'End date');
  if (from > to) throw new ApiError('The start date must be on or before the end date.', 400);
  return { from, to, start: dayStart(from), end: dayEnd(to) };
}

/** { asOf, end } - defaults to today. */
function resolveAsOf(query = {}) {
  const asOf = query.asOf || today();
  parseDay(asOf, 'As-of date');
  return { asOf, end: dayEnd(asOf) };
}

function objectIdParam(value, name) {
  if (value === undefined || value === null || value === '') return null;
  if (!mongoose.Types.ObjectId.isValid(String(value))) throw new ApiError(`Invalid ${name}.`, 400);
  return new mongoose.Types.ObjectId(String(value));
}

function numberParam(value, name, { min, max, integer } = {}) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || (integer && !Number.isInteger(n)) || (min !== undefined && n < min) || (max !== undefined && n > max)) {
    throw new ApiError(`Invalid ${name}.`, 400);
  }
  return n;
}

function enumParam(value, name, allowed) {
  if (value === undefined || value === null || value === '') return null;
  if (!allowed.includes(value)) throw new ApiError(`Invalid ${name}.`, 400);
  return value;
}

// ---------------------------------------------------------------- accounts
/** Every Chart of Accounts account (active or not - inactive accounts can still carry history). */
async function loadAccounts() {
  const accounts = await ChartOfAccount.find({}).populate({ path: 'parentAccount', select: 'name nameAr' }).lean();
  return new Map(accounts.map(a => [String(a._id), a]));
}

const groupOf = account => account?.parentGroupNameEn || account?.parentAccount?.name || null;
const groupArOf = account => account?.parentGroupNameAr || account?.parentAccount?.nameAr || null;
const accountRef = account => (account ? { _id: String(account._id), code: account.code, name: account.name, nameAr: account.nameAr || null } : null);
const accountLabel = account => (account ? `${account.code} - ${account.name}` : null);

/** Signed natural balance: positive when the account carries its normal-side balance. */
const naturalBalance = (account, debit, credit) => round2(DEBIT_NATURE_TYPES.has(account?.type) ? debit - credit : credit - debit);

// ---------------------------------------------------------------- ledger queries
const ledgerMatch = ({ start, end, extra } = {}) => {
  const match = { status: { $in: LEDGER_STATUSES } };
  if (start || end) match.date = { ...(start ? { $gte: start } : {}), ...(end ? { $lte: end } : {}) };
  return { ...match, ...(extra || {}) };
};

/**
 * Debit/credit totals of ledger lines, grouped by account (and optionally by more line fields).
 * `split` returns opening (before `start`) and period ([start, end]) totals in one pass.
 */
async function ledgerTotals({ start = null, end, lineMatch = {}, entryMatch = {}, groupBy = {} } = {}) {
  const groupId = { account: '$lines.account', ...groupBy };
  const before = start ? { $lt: ['$date', start] } : false;
  const rows = await JournalEntry.aggregate([
    { $match: ledgerMatch({ end, extra: entryMatch }) },
    { $unwind: '$lines' },
    ...(Object.keys(lineMatch).length ? [{ $match: lineMatch }] : []),
    {
      $group: {
        _id: groupId,
        openingDebit: { $sum: start ? { $cond: [before, '$lines.debit', 0] } : 0 },
        openingCredit: { $sum: start ? { $cond: [before, '$lines.credit', 0] } : 0 },
        periodDebit: { $sum: start ? { $cond: [before, 0, '$lines.debit'] } : '$lines.debit' },
        periodCredit: { $sum: start ? { $cond: [before, 0, '$lines.credit'] } : '$lines.credit' },
      },
    },
  ]);
  return rows.map(r => ({
    key: r._id,
    accountId: idOf(r._id.account),
    openingDebit: round2(r.openingDebit),
    openingCredit: round2(r.openingCredit),
    periodDebit: round2(r.periodDebit),
    periodCredit: round2(r.periodCredit),
  }));
}

/** Map accountId -> { debit, credit } of every ledger line up to `end` (and from `start`, if given). */
async function balancesByAccount({ start = null, end }) {
  const rows = await JournalEntry.aggregate([
    { $match: ledgerMatch({ start, end }) },
    { $unwind: '$lines' },
    { $group: { _id: '$lines.account', debit: { $sum: '$lines.debit' }, credit: { $sum: '$lines.credit' } } },
  ]);
  return new Map(rows.map(r => [idOf(r._id), { debit: round2(r.debit), credit: round2(r.credit) }]));
}

/** Profit (+) or loss (-) from the P&L accounts' ledger lines in the window. */
function profitFrom(balances, accounts) {
  let profit = 0;
  for (const [accountId, { debit, credit }] of balances) {
    const account = accounts.get(accountId);
    if (account && PROFIT_AND_LOSS_TYPES.has(account.type)) profit += credit - debit;
  }
  return round2(profit);
}

// Hard cap on detail lines one report returns, so a careless filter can never load the whole
// ledger into memory; the report says so when it is reached.
const MAX_DETAIL_ROWS = 20000;

/**
 * Ledger entries (whole entries, all lines) matching `entryMatch` within the window, oldest first.
 * Returns { entries, truncated }.
 */
async function ledgerEntries({ start = null, end, entryMatch = {}, limit = MAX_DETAIL_ROWS }) {
  const entries = await JournalEntry.collection
    .find(ledgerMatch({ start, end, extra: entryMatch }), {
      projection: { entryNumber: 1, date: 1, description: 1, status: 1, accountingAction: 1, sourceType: 1, sourceId: 1, module: 1, reversalOfEntry: 1, triggeredBySalesOrder: 1, project: 1, reference: 1, lines: 1 },
    })
    .sort({ date: 1, entryNumber: 1 })
    .limit(limit + 1)
    .toArray();
  return { entries: entries.slice(0, limit), truncated: entries.length > limit };
}

// ---------------------------------------------------------------- output builders
const L = (en, ar) => ({ en, ar });
const col = (key, en, ar, type = 'text', extra = {}) => ({ key, label: L(en, ar), type, ...extra });
const check = (en, ar, ok, detail = null) => ({ label: L(en, ar), ok: !!ok, detail });
const note = (en, ar) => ({ en, ar });
const summaryItem = (key, en, ar, value, type = 'money') => ({ key, label: L(en, ar), value, type });
const sumBy = (rows, key) => round2(rows.reduce((s, r) => s + (typeof r[key] === 'number' ? r[key] : 0), 0));

const sortAccountsByCode = (rows, getCode) => sortByAccountCode(rows, getCode);

module.exports = {
  LEDGER_STATUSES,
  DEBIT_NATURE_TYPES,
  PROFIT_AND_LOSS_TYPES,
  MAX_DETAIL_ROWS,
  round2,
  pct,
  idOf,
  parseDay,
  dayStart,
  dayEnd,
  resolvePeriod,
  resolveAsOf,
  objectIdParam,
  numberParam,
  enumParam,
  loadAccounts,
  groupOf,
  groupArOf,
  accountRef,
  accountLabel,
  naturalBalance,
  ledgerMatch,
  ledgerTotals,
  balancesByAccount,
  profitFrom,
  ledgerEntries,
  L,
  col,
  check,
  note,
  summaryItem,
  sumBy,
  sortAccountsByCode,
};
