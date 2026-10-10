const JournalEntry = require('../../models/accounting/journalEntryModel');
const FixedAsset = require('../../models/fixedAssets');

// Depreciation figures read from the ledger - the depreciation entries themselves (posted, and
// entries later reversed, with their reversals subtracted) - never from the asset documents' running
// totals, so a figure belongs to the month the depreciation was posted for and is counted once.

const round2 = n => Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100;
const LEDGER = { $in: ['posted', 'reversed'] };

/** Depreciation entries and reversals of them in [start, end] (either bound optional). */
async function depreciationMovements({ start = null, end = null } = {}) {
  const date = { ...(start ? { $gte: start } : {}), ...(end ? { $lte: end } : {}) };
  const dateFilter = Object.keys(date).length ? { date } : {};
  const [entries, reversals] = await Promise.all([
    JournalEntry.collection.find({ accountingAction: 'FIXED_ASSET_DEPRECIATION', status: LEDGER, ...dateFilter }, { projection: { totalDebit: 1 } }).toArray(),
    JournalEntry.collection
      .aggregate([
        { $match: { reversalOfEntry: { $ne: null }, status: LEDGER, ...dateFilter } },
        { $lookup: { from: 'journalentries', localField: 'reversalOfEntry', foreignField: '_id', as: 'original', pipeline: [{ $project: { accountingAction: 1 } }] } },
        { $match: { 'original.accountingAction': 'FIXED_ASSET_DEPRECIATION' } },
        { $project: { totalDebit: 1, reversalOfEntry: 1 } },
      ])
      .toArray(),
  ]);
  return { entries, reversals };
}

/** Depreciation and amortization expense of a period (net of reversals dated in it). */
async function depreciationInPeriod(start, end) {
  const { entries, reversals } = await depreciationMovements({ start, end });
  return round2(entries.reduce((s, e) => s + (e.totalDebit || 0), 0) - reversals.reduce((s, e) => s + (e.totalDebit || 0), 0));
}

/**
 * Net book value of the assets at `end`: cost less the depreciation posted up to that date (net of
 * reversals up to that date). An asset created before the Fixed Assets module, with no depreciation
 * entries, keeps its recorded Book Value.
 */
async function netBookValueAsOf(end, assetFilter = {}) {
  const [assets, { entries, reversals }] = await Promise.all([FixedAsset.find(assetFilter).lean(), depreciationMovements({ end })]);
  const amountByEntry = new Map(entries.map(e => [String(e._id), e.totalDebit || 0]));
  const reversedAmount = new Map();
  reversals.forEach(r => reversedAmount.set(String(r.reversalOfEntry), (reversedAmount.get(String(r.reversalOfEntry)) || 0) + (r.totalDebit || 0)));
  return round2(
    assets.reduce((sum, asset) => {
      const records = asset.depreciations || [];
      if (!records.length || typeof asset.price !== 'number') return sum + (asset.bookValue || 0);
      const accumulated = records.reduce((s, d) => s + (amountByEntry.get(String(d.journalEntry)) || 0) - (reversedAmount.get(String(d.journalEntry)) || 0), 0);
      return sum + Math.max(0, asset.price - accumulated);
    }, 0)
  );
}

module.exports = { depreciationInPeriod, netBookValueAsOf };
