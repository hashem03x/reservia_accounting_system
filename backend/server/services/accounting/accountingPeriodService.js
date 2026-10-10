const AccountingPeriod = require('../../models/accounting/accountingPeriodModel');
const ApiError = require('../../utils/apiError');

// Closed accounting periods - the single check every accounting write goes through.
//
// journalEntryModel.js's pre('save') hook calls assertPeriodsOpen for every journal entry that is
// created, edited, re-dated or posted (manual entries, reversals and every automatic entry), and
// every business operation that posts one (Sales/Purchase Orders, payments, expenses, fixed assets,
// depreciation, advanced payments, PUC transfers, equity) runs inside a MongoDB transaction - so a
// rejected entry rolls the whole operation back and nothing is left half-written. Operations that
// are dated before they reach their journal entry also call it up front, for an early, clear error.

const PERIOD_CLOSED_MESSAGE = 'Accounting period is closed. Please contact the administrator to reopen it.';
const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/** 'YYYY-MM' of a date (UTC calendar month), or null for a missing/invalid date. */
function periodOf(date) {
  if (!date) return null;
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 7);
}

/**
 * Throws the closed-period error (HTTP 400, details.code 'ACCOUNTING_PERIOD_CLOSED', with the
 * period and date) when any of `dates` falls in a closed month. Reads inside `session` when given.
 */
async function assertPeriodsOpen(dates, session) {
  const list = (Array.isArray(dates) ? dates : [dates]).filter(Boolean);
  const periods = [...new Set(list.map(periodOf).filter(Boolean))];
  if (periods.length === 0) return;
  const closed = await AccountingPeriod.findOne({ period: { $in: periods }, status: 'closed' })
    .select('period')
    .session(session || null)
    .lean();
  if (!closed) return;
  const day = new Date(list.find(d => periodOf(d) === closed.period)).toISOString().slice(0, 10);
  throw new ApiError(`${PERIOD_CLOSED_MESSAGE} (Closed period: ${closed.period}, date ${day})`, 400, { code: 'ACCOUNTING_PERIOD_CLOSED', period: closed.period, date: day });
}

const isPeriodClosedError = err => err?.details?.code === 'ACCOUNTING_PERIOD_CLOSED';

function validPeriod(period) {
  if (!PERIOD_PATTERN.test(String(period || ''))) throw new ApiError('The accounting period must be in YYYY-MM format.', 400);
  return period;
}

async function listPeriods() {
  return AccountingPeriod.find({}).populate({ path: 'closedBy reopenedBy history.by', select: 'name' }).sort({ period: -1 }).lean();
}

async function closePeriod(period, userId, note) {
  validPeriod(period);
  const now = new Date();
  if (period > periodOf(now)) throw new ApiError('A future accounting period cannot be closed.', 400);
  const existing = await AccountingPeriod.findOne({ period }).lean();
  if (existing?.status === 'closed') throw new ApiError(`Accounting period ${period} is already closed.`, 400);
  return AccountingPeriod.findOneAndUpdate(
    { period },
    { $set: { status: 'closed', closedBy: userId, closedAt: now }, $push: { history: { action: 'closed', by: userId, at: now, note } } },
    { upsert: true, new: true, runValidators: true }
  );
}

async function reopenPeriod(period, userId, note) {
  validPeriod(period);
  const now = new Date();
  const reopened = await AccountingPeriod.findOneAndUpdate(
    { period, status: 'closed' },
    { $set: { status: 'open', reopenedBy: userId, reopenedAt: now }, $push: { history: { action: 'reopened', by: userId, at: now, note } } },
    { new: true, runValidators: true }
  );
  if (!reopened) throw new ApiError(`Accounting period ${period} is not closed.`, 400);
  return reopened;
}

module.exports = { PERIOD_CLOSED_MESSAGE, periodOf, assertPeriodsOpen, isPeriodClosedError, listPeriods, closePeriod, reopenPeriod };
