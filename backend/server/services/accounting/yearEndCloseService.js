const mongoose = require('mongoose');
const FiscalYearClose = require('../../models/accounting/fiscalYearCloseModel');
const AccountingPeriod = require('../../models/accounting/accountingPeriodModel');
const JournalEntry = require('../../models/accounting/journalEntryModel');
const ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
const ApiError = require('../../utils/apiError');
const { YearEndAccountCodes } = require('../../utils/accountingConstants');
const { getNextJournalEntryNumber } = require('./journalEntryNumberService');
const { mirrorReverseEntry } = require('./journalReversalCore');

// ERP CHG-09 (12 Nov 2026) - year-end close: "moves revenue and expenses to profit of the year and
// retained earnings, locks the year, and allows a controlled reopen with an audit trail".
//
// Close (one transaction):
//   1. Entry A, dated 31 Dec: every revenue / cost of sales / expense account's balance for the year
//      is brought to zero against Profit of the year (YearEndAccountCodes.profitOfYear).
//   2. Entry B, dated 31 Dec: Profit of the year is transferred to Retained Earnings.
//      After the close: revenue and expense accounts are zero for the year, Retained Earnings holds
//      the profit (acceptance test), and the Statement of Profit or Loss still shows the year's
//      figures (it leaves out entries marked `yearEndClose`).
//   3. The twelve months are locked (AccountingPeriod), so nothing can be posted into the year.
// Reopen (administrator, a reason is required): both entries are reversed (mirror entries, also
// marked `yearEndClose`), the months are unlocked, and the event is recorded.
// The month locks a year-end close sets are recorded with the note "Year-end close YYYY".

const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
const PL_TYPES = ['revenue', 'expense', 'cogs'];
const LEDGER_STATUSES = ['posted', 'reversed'];
const monthsOf = year => Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);

function validYear(year) {
  const y = Number(year);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) throw new ApiError('The year must be a four-digit year.', 400);
  if (y > new Date().getUTCFullYear()) throw new ApiError('A future year cannot be closed.', 400);
  return y;
}

async function equityAccount(code, label, session) {
  const account = await ChartOfAccount.findOne({ code }).session(session || null).lean();
  if (!account) throw new ApiError(`Year-end close needs the ${label} account (${code}) in the Chart of Accounts.`, 400);
  if (account.type !== 'equity') throw new ApiError(`Account ${code} (${label}) must be an equity account.`, 400);
  return account;
}

/** The year's balance of every profit-and-loss account (debit - credit), closing entries left out. */
async function profitAndLossBalances(year, session) {
  const accounts = await ChartOfAccount.find({ type: { $in: PL_TYPES } }).select('_id code name type').session(session || null).lean();
  if (!accounts.length) return [];
  const rows = await JournalEntry.aggregate([
    { $match: { status: { $in: LEDGER_STATUSES }, yearEndClose: null, date: { $gte: new Date(Date.UTC(year, 0, 1)), $lte: new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999)) } } },
    { $unwind: '$lines' },
    { $match: { 'lines.account': { $in: accounts.map(a => a._id) } } },
    { $group: { _id: '$lines.account', debit: { $sum: '$lines.debit' }, credit: { $sum: '$lines.credit' } } },
  ]).session(session || null);
  const byId = new Map(accounts.map(a => [String(a._id), a]));
  return rows.map(r => ({ account: byId.get(String(r._id)), net: round2(r.debit - r.credit) })).filter(r => r.account && r.net !== 0);
}

async function listYears() {
  return FiscalYearClose.find({}).sort({ year: -1 }).lean();
}

/** What a close of `year` would post - shown to the administrator before confirming. */
async function previewClose(year) {
  const y = validYear(year);
  const balances = await profitAndLossBalances(y);
  const profit = round2(-balances.reduce((s, b) => s + b.net, 0));
  return { year: y, profit, accounts: balances.map(b => ({ code: b.account.code, name: b.account.name, type: b.account.type, balance: b.net })) };
}

async function closeYear(year, user, note) {
  const y = validYear(year);
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const existing = await FiscalYearClose.findOne({ year: y }).session(session);
      if (existing?.status === 'closed') throw new ApiError(`${y} is already closed.`, 400);
      const december = await AccountingPeriod.findOne({ period: `${y}-12`, status: 'closed' }).session(session).lean();
      if (december) throw new ApiError(`December ${y} is locked. Reopen it on the Accounting Periods page, then close the year (the closing entries are dated 31 December).`, 400);

      const [poy, re] = await Promise.all([equityAccount(YearEndAccountCodes.profitOfYear, 'Profit of the year', session), equityAccount(YearEndAccountCodes.retainedEarnings, 'Retained Earnings', session)]);
      const balances = await profitAndLossBalances(y, session);
      const profit = round2(-balances.reduce((s, b) => s + b.net, 0));
      const date = new Date(Date.UTC(y, 11, 31, 12));
      const runId = new mongoose.Types.ObjectId();
      const common = { date, status: 'posted', source: 'automatic', module: 'Manual', classification: 'ga', project: null, yearEndClose: y, createdBy: user?._id || null, postedBy: user?._id || null, postedAt: new Date(), currency: 'EGP', currencyUnitsPerBase: 1 };
      const entries = [];

      if (balances.length) {
        const description = `Year-end close ${y} - revenue and expenses to profit of the year`;
        const lines = balances.map(b => ({ account: b.account._id, debit: b.net < 0 ? -b.net : 0, credit: b.net > 0 ? b.net : 0, description }));
        if (profit !== 0) lines.push({ account: poy._id, debit: profit < 0 ? -profit : 0, credit: profit > 0 ? profit : 0, description });
        const [a] = await JournalEntry.create([{ ...common, entryNumber: await getNextJournalEntryNumber(session), description, reference: `YE-${y}`, sourceType: 'YEAR_END_CLOSE', sourceId: runId, lines }], { session });
        entries.push(a);
      }
      if (profit !== 0) {
        const description = `Year-end close ${y} - profit of the year to retained earnings`;
        const lines = [
          { account: poy._id, debit: profit > 0 ? profit : 0, credit: profit < 0 ? -profit : 0, description },
          { account: re._id, debit: profit < 0 ? -profit : 0, credit: profit > 0 ? profit : 0, description },
        ];
        const [b] = await JournalEntry.create([{ ...common, entryNumber: await getNextJournalEntryNumber(session), description, reference: `YE-${y}`, sourceType: 'YEAR_END_TRANSFER', sourceId: runId, lines }], { session });
        entries.push(b);
      }

      const now = new Date();
      // Lock every month of the year (a month already locked stays as it is).
      const alreadyClosed = new Set((await AccountingPeriod.find({ period: { $in: monthsOf(y) }, status: 'closed' }).select('period').session(session).lean()).map(p => p.period));
      for (const period of monthsOf(y).filter(p => !alreadyClosed.has(p))) {
        // eslint-disable-next-line no-await-in-loop
        await AccountingPeriod.updateOne(
          { period },
          { $set: { status: 'closed', closedBy: user?._id || null, closedAt: now }, $push: { history: { action: 'closed', by: user?._id || null, at: now, note: `Year-end close ${y}` } } },
          { upsert: true, session }
        );
      }

      result = await FiscalYearClose.findOneAndUpdate(
        { year: y },
        {
          $set: { status: 'closed', profit, closingEntries: entries.map(e => e._id) },
          $push: { history: { action: 'closed', by: user?._id || null, byName: user?.name || null, at: now, note, profit, entries: entries.map(e => e._id) } },
        },
        { upsert: true, new: true, session }
      );
    });
  } finally {
    session.endSession();
  }
  return result;
}

async function reopenYear(year, user, note) {
  const y = validYear(year);
  if (!note || String(note).trim().length < 3) throw new ApiError('Give the reason for reopening the year.', 400);
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const doc = await FiscalYearClose.findOne({ year: y }).session(session);
      if (!doc || doc.status !== 'closed') throw new ApiError(`${y} is not closed.`, 400);
      const now = new Date();
      // Unlock the months first - the reversals are dated in December.
      await AccountingPeriod.updateMany(
        { period: { $in: monthsOf(y) }, status: 'closed' },
        { $set: { status: 'open', reopenedBy: user?._id || null, reopenedAt: now }, $push: { history: { action: 'reopened', by: user?._id || null, at: now, note: `Year-end reopen ${y}: ${String(note).trim()}`.slice(0, 500) } } },
        { session }
      );
      const reversals = [];
      for (const id of doc.closingEntries) {
        // eslint-disable-next-line no-await-in-loop
        const { reversal } = await mirrorReverseEntry({ entryId: id, date: new Date(Date.UTC(y, 11, 31, 12)), reference: `YE-${y}-REOPEN`, reason: `Year-end reopen ${y}`, userId: user?._id || null, session });
        // eslint-disable-next-line no-await-in-loop
        await JournalEntry.updateOne({ _id: reversal._id }, { $set: { yearEndClose: y } }, { session });
        reversals.push(reversal._id);
      }
      doc.status = 'open';
      doc.closingEntries = [];
      doc.history.push({ action: 'reopened', by: user?._id || null, byName: user?.name || null, at: now, note: String(note).trim(), profit: doc.profit, entries: reversals });
      result = await doc.save({ session });
    });
  } finally {
    session.endSession();
  }
  return result;
}

module.exports = { listYears, previewClose, closeYear, reopenYear, profitAndLossBalances };
