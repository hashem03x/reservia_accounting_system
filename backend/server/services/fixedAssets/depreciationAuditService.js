const JournalEntry = require('../../models/accounting/journalEntryModel');
const FixedAsset = require('../../models/fixedAssets');
const { assertPeriodsOpen } = require('../accounting/accountingPeriodService');
const { logAccountingEvent } = require('../../utils/accountingLogger');

// Audit (read-only) and repair of existing depreciation / amortization postings. The repair only
// ever re-dates posted depreciation entries dated in the future - every other finding is listed for
// manual accounting review, never changed here. No entry is created, deleted or re-posted.

const round2 = n => Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100;
const idOf = v => (v ? String(v._id || v) : null);
const day = d => (d ? new Date(d).toISOString().slice(0, 10) : null);
const ACTION = 'FIXED_ASSET_DEPRECIATION';
const REDATE_REASON = 'Depreciation entry dated after it was posted (month-end of a month still in progress); re-dated to its posting date so the Trial Balance and reports include it.';

/**
 * Every depreciation record of every fixed asset against its journal entry, and every depreciation
 * entry against the assets. Returns { futureDated, issues, checked }:
 *   futureDated - posted depreciation entries dated after `now` (what `repairFutureDatedDepreciation`
 *                 re-dates), each with the date it would get;
 *   issues      - everything else that needs an accountant's review (missing / unposted / unbalanced
 *                 entries, accounts or amounts different from the asset, entries no asset refers to,
 *                 an asset whose accumulated depreciation differs from its records).
 */
async function auditDepreciation({ now = new Date() } = {}) {
  const [assets, entries] = await Promise.all([
    FixedAsset.collection
      .find({ 'depreciations.0': { $exists: true } }, { projection: { name: 1, assetNumber: 1, accumulatedDepreciation: 1, depreciationAccountId: 1, accumulatedAccountId: 1, depreciations: 1 } })
      .toArray(),
    JournalEntry.collection.find({ accountingAction: ACTION }, { projection: { entryNumber: 1, date: 1, status: 1, lines: 1, totalDebit: 1, totalCredit: 1, createdAt: 1 } }).toArray(),
  ]);
  const entryById = new Map(entries.map(e => [String(e._id), e]));
  const referenced = new Set();
  const issues = [];
  const futureDated = [];
  const issue = (kind, asset, record, entry, detail) =>
    issues.push({ kind, asset: asset ? { _id: String(asset._id), name: asset.name } : null, period: record?.period || null, entryNumber: entry?.entryNumber ?? null, entryId: entry ? String(entry._id) : null, detail });

  for (const asset of assets) {
    let liveTotal = 0;
    for (const record of asset.depreciations || []) {
      if (!record.reversed) liveTotal += record.amount || 0;
      const entry = entryById.get(idOf(record.journalEntry));
      if (!entry) {
        issue('missing_entry', asset, record, null, `No depreciation journal entry found for ${record.period} (${record.amount}).`);
        continue;
      }
      referenced.add(String(entry._id));
      if (!record.reversed && entry.status !== 'posted') {
        issue(entry.status === 'reversed' ? 'reversed_not_applied' : 'not_posted', asset, record, entry, `The asset counts ${record.period} but its entry is "${entry.status}".`);
      }
      const debits = (entry.lines || []).filter(l => (l.debit || 0) > 0);
      const credits = (entry.lines || []).filter(l => (l.credit || 0) > 0);
      const totalDebit = round2(debits.reduce((s, l) => s + l.debit, 0));
      const totalCredit = round2(credits.reduce((s, l) => s + l.credit, 0));
      if (!entry.lines?.length) issue('no_lines', asset, record, entry, 'The entry has no lines.');
      else if (totalDebit !== totalCredit) issue('unbalanced', asset, record, entry, `Debit ${totalDebit} / credit ${totalCredit}.`);
      else if (totalDebit !== round2(record.amount)) issue('amount_mismatch', asset, record, entry, `Entry ${totalDebit}, asset record ${record.amount}.`);
      if (debits.some(l => idOf(l.account) !== idOf(asset.depreciationAccountId)) || credits.some(l => idOf(l.account) !== idOf(asset.accumulatedAccountId))) {
        issue('account_mismatch', asset, record, entry, "The entry's accounts are not the asset's depreciation / accumulated accounts.");
      }
      if (entry.date > now) {
        if (entry.status === 'posted') futureDated.push({ entryId: String(entry._id), entryNumber: entry.entryNumber, asset: { _id: String(asset._id), name: asset.name }, period: record.period, amount: record.amount, date: day(entry.date), newDate: day(redateTo(entry, now)) });
        else issue('future_dated_not_posted', asset, record, entry, `Dated ${day(entry.date)} with status "${entry.status}" - not re-dated automatically.`);
      }
    }
    if (round2(liveTotal) !== round2(asset.accumulatedDepreciation || 0)) {
      issue('asset_total_mismatch', asset, null, null, `Accumulated depreciation on the asset ${round2(asset.accumulatedDepreciation || 0)}, its depreciation records ${round2(liveTotal)}.`);
    }
  }
  for (const entry of entries) {
    if (!referenced.has(String(entry._id)) && entry.status !== 'draft') issue('orphan_entry', null, null, entry, `Depreciation entry dated ${day(entry.date)} (${entry.totalDebit}) that no fixed asset refers to.`);
  }
  return { checked: { assets: assets.length, entries: entries.length }, futureDated, issues };
}

// The date a future-dated entry gets: when it was posted (never before its month's first day, never
// after `now`) - the date the depreciation run gives a month still in progress today.
function redateTo(entry, now) {
  const monthStart = new Date(Date.UTC(entry.date.getUTCFullYear(), entry.date.getUTCMonth(), 1));
  const posted = entry.createdAt && entry.createdAt <= now ? entry.createdAt : now;
  return posted < monthStart ? monthStart : posted;
}

/**
 * Re-dates the posted depreciation entries dated in the future (and the date on the asset's
 * depreciation record) to the moment they were posted. Idempotent - an entry is only changed while
 * it is still dated after `now`, so a second run finds nothing. The original date is kept on the
 * entry (`dateCorrection`) and each change is logged. Amounts, accounts, entry numbers and statuses
 * are never touched.
 */
async function repairFutureDatedDepreciation({ now = new Date(), session = null } = {}) {
  const entries = await JournalEntry.collection.find({ accountingAction: ACTION, status: 'posted', date: { $gt: now } }, { projection: { entryNumber: 1, date: 1, createdAt: 1 }, session: session || undefined }).toArray();
  const changed = [];
  for (const entry of entries) {
    const newDate = redateTo(entry, now);
    // eslint-disable-next-line no-await-in-loop
    await assertPeriodsOpen(newDate, session);
    // eslint-disable-next-line no-await-in-loop
    const { modifiedCount } = await JournalEntry.collection.updateOne(
      { _id: entry._id, status: 'posted', date: entry.date },
      { $set: { date: newDate, dateCorrection: { from: entry.date, to: newDate, at: now, reason: REDATE_REASON } } },
      { session: session || undefined }
    );
    if (!modifiedCount) continue;
    // eslint-disable-next-line no-await-in-loop
    await FixedAsset.collection.updateOne({ 'depreciations.journalEntry': entry._id }, { $set: { 'depreciations.$.date': newDate } }, { session: session || undefined });
    logAccountingEvent('DEPRECIATION_ENTRY_REDATED', { journalEntryId: String(entry._id), entryNumber: entry.entryNumber, from: entry.date.toISOString(), to: newDate.toISOString() });
    changed.push({ entryId: String(entry._id), entryNumber: entry.entryNumber, from: day(entry.date), to: day(newDate) });
  }
  return changed;
}

module.exports = { auditDepreciation, repairFutureDatedDepreciation };
