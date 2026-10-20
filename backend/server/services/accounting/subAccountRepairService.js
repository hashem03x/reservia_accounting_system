const mongoose = require('mongoose');
const JournalEntry = require('../../models/accounting/journalEntryModel');
const ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
const User = require('../../models/userModel');
const Vendor = require('../../models/vendor/vendor');
const { CUSTOMER_CONTROL_CODES, VENDOR_CONTROL_CODES } = require('./journalLinePartyService');
const { resolveSubAccountsForEntries } = require('./generalLedgerService');
const { LEDGER_STATUSES, round2 } = require('../reports/reportCommon');

// Historical remediation for journal entry lines on a customer/vendor control account (Accounts
// Receivable - Projects, Advances from Customers, Suppliers, Advances to Suppliers) whose Sub
// Account is missing, the wrong kind, or names a party that no longer exists - the exact
// "Unassigned"/"Unknown" rows services/reports/partyReports.js already surfaces. Entirely
// deterministic: a line is only ever proposed for a fix when the SAME evidence the automatic
// accounting engine and the General Ledger already trust (the entry's own sourceType/sourceId, via
// generalLedgerService.js#resolveSubAccountsForEntries - the shared resolver this module reuses
// rather than re-implementing) or a PAIRED control-account line in the very same entry (the
// "both lines are the same party" rule journalEntryModel.js RULE 5 / accountingEventService.js now
// enforce going forward) names exactly one real, correctly-typed party. Anything else - no
// evidence, conflicting evidence, or an EXISTING but wrong value - is left for manual review;
// this module never invents a party and never overwrites a value that was already set.

const idOf = ref => (ref ? String(ref._id || ref) : null);

async function controlAccountTypeById() {
  const codes = [...CUSTOMER_CONTROL_CODES, ...VENDOR_CONTROL_CODES];
  const accounts = await ChartOfAccount.find({ code: { $in: codes } })
    .select('code')
    .lean();
  const byId = new Map();
  for (const account of accounts) byId.set(String(account._id), CUSTOMER_CONTROL_CODES.includes(account.code) ? 'customer' : 'vendor');
  return byId;
}

function hasNumber(value) {
  return value !== null && value !== undefined && value !== '';
}

/**
 * The shared classification core (never called directly outside this module): given a set of
 * already-fetched entries and the control-account-id -> required-party-type map they were
 * selected by, sorts every qualifying line into `autoFixable` (missing, resolved by exactly one
 * real party) or `review` (wrong kind, unknown number, or missing with no/conflicting evidence).
 * Reused by both the full historical diagnosis and a report's narrower, date-ranged summary, so
 * there is exactly one implementation of what counts as "resolvable".
 */
async function classifyEntries(entries, typeByAccountId) {
  // Every line's own party number that IS present and correctly typed - existence is checked in one
  // batch (never one query per line), both to flag an unknown number and to validate a paired-line
  // candidate before trusting it as evidence for a DIFFERENT line's fix.
  const referencedCustomerNumbers = new Set();
  const referencedVendorNumbers = new Set();
  for (const entry of entries) {
    for (const line of entry.lines) {
      const requiredType = typeByAccountId.get(idOf(line.account));
      if (requiredType && hasNumber(line.partyNumber) && line.partyType === requiredType) {
        (requiredType === 'customer' ? referencedCustomerNumbers : referencedVendorNumbers).add(Number(line.partyNumber));
      }
    }
  }
  const [customers, vendors] = await Promise.all([
    referencedCustomerNumbers.size ? User.find({ customerNumber: { $in: [...referencedCustomerNumbers] } }).select('customerNumber').lean() : [],
    referencedVendorNumbers.size ? Vendor.find({ vendorNumber: { $in: [...referencedVendorNumbers] } }).select('vendorNumber').lean() : [],
  ]);
  const existingCustomerNumbers = new Set(customers.map(c => c.customerNumber));
  const existingVendorNumbers = new Set(vendors.map(v => v.vendorNumber));
  const numberExists = (type, number) => (type === 'customer' ? existingCustomerNumbers : existingVendorNumbers).has(number);

  // Entry-wide fallback (the General Ledger's own resolution) - only computed for entries that
  // actually have a problem line, and only trusted when it resolves to a real, existing party.
  const problemEntries = entries.filter(entry => entry.lines.some(line => typeByAccountId.has(idOf(line.account)) && (!hasNumber(line.partyNumber) || line.partyType !== typeByAccountId.get(idOf(line.account)))));
  const fallbackByEntryId = await resolveSubAccountsForEntries(problemEntries);

  const autoFixable = [];
  const review = [];
  for (const entry of entries) {
    entry.lines.forEach((line, lineIndex) => {
      const requiredType = typeByAccountId.get(idOf(line.account));
      if (!requiredType) return;
      const amount = Math.max(line.debit || 0, line.credit || 0);
      const base = { entryId: entry._id, entryNumber: entry.entryNumber, date: entry.date, lineIndex, requiredType, amount };

      if (hasNumber(line.partyNumber) && line.partyType === requiredType) {
        if (!numberExists(requiredType, Number(line.partyNumber))) {
          review.push({ ...base, kind: 'unknown_number', existingPartyNumber: Number(line.partyNumber), existingPartyType: line.partyType, reason: `${requiredType} number ${line.partyNumber} does not exist` });
        }
        return; // correctly assigned - nothing to do
      }

      if (hasNumber(line.partyNumber) && line.partyType !== requiredType) {
        review.push({ ...base, kind: 'wrong_type', existingPartyNumber: Number(line.partyNumber), existingPartyType: line.partyType, reason: `account requires a ${requiredType} sub-account, line has a ${line.partyType || 'untyped'} one - never overwritten automatically` });
        return;
      }

      // Missing entirely - the only kind ever auto-fixed, and only with unambiguous evidence.
      // resolveSubAccountsForEntries already looks the number up against a real User/Vendor
      // document itself (it only ever returns a number it found), so its result needs no second
      // existence check here - re-checking it against existingCustomerNumbers/existingVendorNumbers
      // (built only from lines that already carry a stamped number) would wrongly discard a real,
      // resolvable fallback whenever this is the only line in the batch that references that party.
      const candidates = new Set();
      const fallback = fallbackByEntryId.get(String(entry._id));
      if (fallback && fallback.type === requiredType && fallback.number != null) candidates.add(fallback.number);
      entry.lines.forEach((other, otherIndex) => {
        if (otherIndex === lineIndex) return;
        if (typeByAccountId.get(idOf(other.account)) !== requiredType) return;
        if (hasNumber(other.partyNumber) && other.partyType === requiredType && numberExists(requiredType, Number(other.partyNumber))) candidates.add(Number(other.partyNumber));
      });

      if (candidates.size === 1) {
        const [resolvedNumber] = candidates;
        autoFixable.push({ ...base, kind: 'missing', resolvedNumber, evidence: fallback && fallback.number === resolvedNumber ? 'source_document' : 'paired_line' });
      } else if (candidates.size > 1) {
        review.push({ ...base, kind: 'missing', reason: `ambiguous - conflicting candidates: ${[...candidates].join(', ')}` });
      } else {
        review.push({ ...base, kind: 'missing', reason: 'no source document or paired line names a real party - left for manual assignment' });
      }
    });
  }

  return { autoFixable, review };
}

/**
 * Scans every ledger-affecting journal entry for control-account lines whose Sub Account is
 * missing, the wrong kind, or unknown, and classifies each one. Entirely read-only.
 *
 * @returns {Promise<{
 *   checked: number,
 *   autoFixable: Array<{entryId, entryNumber, lineIndex, requiredType, resolvedNumber, amount, evidence}>,
 *   review: Array<{entryId, entryNumber, lineIndex, requiredType, kind, existingPartyNumber, existingPartyType, amount, reason}>,
 * }>}
 */
async function diagnoseUnassignedSubAccounts() {
  const typeByAccountId = await controlAccountTypeById();
  const accountIds = [...typeByAccountId.keys()].map(id => new mongoose.Types.ObjectId(id));
  if (!accountIds.length) return { checked: 0, autoFixable: [], review: [] };

  const entries = await JournalEntry.find({ status: { $in: LEDGER_STATUSES }, 'lines.account': { $in: accountIds } })
    .select('entryNumber date sourceType sourceId project lines')
    .lean();

  const { autoFixable, review } = await classifyEntries(entries, typeByAccountId);
  return { checked: entries.length, autoFixable, review };
}

/**
 * A narrower, date-ranged version of the same classification, scoped to a specific report's own
 * control account(s) - used to annotate a report's "Unassigned" row with how much of it is
 * actually resolvable (same evidence, same rules) versus genuinely needs manual review, WITHOUT
 * changing any balance, total or reconciliation check the report already computes. Never writes
 * anything; running services/scripts/repairUnassignedSubAccounts.js is what actually fixes the
 * data (and once it does, this summary - and the report's real Unassigned total - shrink on their
 * own, with no further code change needed here).
 */
async function summarizeUnassignedForAccounts({ accountIds, requiredType, start, end }) {
  if (!accountIds?.length) return { resolvableAmount: 0, resolvableCount: 0, reviewAmount: 0, reviewCount: 0 };
  const typeByAccountId = new Map(accountIds.map(id => [String(id), requiredType]));
  const match = { status: { $in: LEDGER_STATUSES }, 'lines.account': { $in: accountIds } };
  if (start || end) match.date = { ...(start ? { $gte: start } : {}), ...(end ? { $lte: end } : {}) };

  const entries = await JournalEntry.find(match)
    .select('entryNumber date sourceType sourceId project lines')
    .lean();
  const { autoFixable, review } = await classifyEntries(entries, typeByAccountId);
  const sumOf = list => round2(list.reduce((sum, r) => sum + r.amount, 0));
  return { resolvableAmount: sumOf(autoFixable), resolvableCount: autoFixable.length, reviewAmount: sumOf(review), reviewCount: review.length };
}

/**
 * Applies ONLY the `autoFixable` plan from diagnoseUnassignedSubAccounts (re-call it first, never
 * trust a stale plan) by writing `lines.<i>.partyNumber`/`partyType` directly - nothing else is
 * ever touched (no amounts, accounts, dates, statuses), and no journal entry is re-saved, re-posted
 * or duplicated. Each write re-checks the line is still missing its Sub Account before applying, so
 * a line already fixed (by this or another process) since the plan was built is skipped, not
 * clobbered.
 */
async function applySubAccountRepairs(autoFixable) {
  const collection = JournalEntry.collection;
  const results = [];
  for (const fix of autoFixable) {
    const field = `lines.${fix.lineIndex}`;
    // A plain `{'lines.<i>.partyNumber': null}` query filter is NOT a reliable positional re-check:
    // MongoDB's dotted array-index query syntax also matches when ANY element of the array has a
    // null partyNumber, not only the one at this exact index - confirmed by direct testing. `$expr`
    // with `$arrayElemAt` pins the check to the exact index, so a line genuinely fixed by something
    // else since the plan was built is correctly left alone, never clobbered.
    // eslint-disable-next-line no-await-in-loop
    const result = await collection.updateOne(
      { _id: fix.entryId, $expr: { $eq: [{ $ifNull: [{ $arrayElemAt: ['$lines.partyNumber', fix.lineIndex] }, null] }, null] } },
      { $set: { [`${field}.partyNumber`]: fix.resolvedNumber, [`${field}.partyType`]: fix.requiredType } }
    );
    results.push({ ...fix, applied: result.modifiedCount === 1 });
  }
  return results;
}

module.exports = { diagnoseUnassignedSubAccounts, summarizeUnassignedForAccounts, applySubAccountRepairs };
