'use strict';

const mongoose = require('mongoose');
const ApiError = require('../../utils/apiError');
const { getAccountIdByCode, postAutomaticJournalEntry, deterministicSourceId } = require('./accountingEventService');

// Go-live Developer Pack F14: "Payroll does not reach the ERP... Post the closed HR month inside
// the platform to mapped ERP accounts and return the journal number to HR." Replaces the old
// hrPayrollService.js#postToErp external-HTTP call (a plain fetch to a configurable `cfg.erpUrl`
// with a custom payload shape and a static bearer token) - there was never a real receiver for
// that contract, so every post either failed outright or, worse, could have been silently
// "succeeded" against any endpoint that happened to answer 2xx with an id-like field, without ever
// creating a real accounting record. This posts a REAL JournalEntry in this same platform's own
// Chart of Accounts, through the same postAutomaticJournalEntry engine every other automatic
// posting (Purchase Orders, Sales Orders, Expenses, Fixed Assets) already uses - same idempotency
// guarantee (one entry per HR payroll month, safe to call again), same "never fabricate a missing
// account" guarantee (throws a clear, named error instead of guessing or skipping a line).
//
// services/hr/payrollEngine.js#erpJournal() already builds the payload this consumes - each line's
// `account` is the HR Settings "ERP account mapping" value (ERP_KEYS.gl, Finance-editable), stored
// as "<code> <display name>" (e.g. "5100 Salaries and wages") for readability in the HR Settings
// screen; only the leading code token is a real Chart of Accounts lookup key.

function leadingCode(glValue) {
  return String(glValue || '').trim().split(/\s+/)[0] || '';
}

/**
 * Posts (or returns the already-posted) JournalEntry for one HR payroll month's journal payload
 * (services/hr/payrollEngine.js#erpJournal's return shape: `{company, period, lines: [{account,
 * debit, credit, memo}], ...}`). Idempotent per month - calling this again for a month that was
 * already posted returns the SAME entry rather than creating a second one (mirrors every other
 * automatic posting's (sourceType, sourceId, accountingAction) guarantee).
 *
 * Throws a clear ApiError (never silently skips a line or guesses an account) the first time a
 * mapped GL code does not exist in the live Chart of Accounts - exactly the scenario F14 describes
 * ("HR accounts 5100 to 2330 are not in the ERP chart"). Finance fixes this by either creating the
 * missing accounts or repointing the HR Settings ERP account mapping at ones that already exist -
 * neither of which this function can or should decide on its own.
 */
async function postHrPayrollJournal(month, payload, { session } = {}) {
  if (!payload?.lines?.length) throw new ApiError('This payroll month has nothing to post - recompute it first.', 400);

  const run = async activeSession => {
    const lines = [];
    for (const line of payload.lines) {
      const code = leadingCode(line.account);
      if (!code) throw new ApiError(`Payroll journal line "${line.memo || ''}" has no mapped ERP account - set it on the HR Settings > ERP link page first.`, 400);
      const accountId = await getAccountIdByCode(code, activeSession);
      lines.push({ account: accountId, debit: line.debit || 0, credit: line.credit || 0, description: line.memo || undefined });
    }

    const entry = await postAutomaticJournalEntry({
      accountingAction: 'HR_PAYROLL_POST',
      sourceType: 'HR_PAYROLL',
      sourceId: deterministicSourceId(`hr-payroll-${month}`),
      date: new Date(),
      description: `HR Payroll - ${month}`,
      lines,
      session: activeSession,
    });
    return entry;
  };

  // A caller already inside its own transaction passes `session` straight through (never opens a
  // second, nested one); otherwise this opens its own - posting a multi-line journal entry is
  // exactly the kind of multi-document write that must never partially apply.
  if (session) return run(session);
  const newSession = await mongoose.startSession();
  try {
    let entry;
    await newSession.withTransaction(async () => {
      entry = await run(newSession);
    });
    return entry;
  } finally {
    await newSession.endSession();
  }
}

module.exports = { postHrPayrollJournal };
