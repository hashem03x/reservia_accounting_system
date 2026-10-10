const mongoose = require('mongoose');
const FixedAsset = require('../../models/fixedAssets');
const FixedAssetDepreciationRun = require('../../models/fixedAssetDepreciationRunModel');
const Vendor = require('../../models/vendor/vendor');
const ApiError = require('../../utils/apiError');
const { computeOrderTotals, round2 } = require('../../utils/orderTotals');
const { AutomaticJournalAccountCodes } = require('../../utils/accountingConstants');
const { postAutomaticJournalEntry, getAccountIdByCode, resolveVendorNumber, deterministicSourceId } = require('../accounting/accountingEventService');
const { resolveFixedAssetAccounts } = require('./fixedAssetAccounts');
const { getNextFixedAssetNumber } = require('./fixedAssetNumberService');
const { assertPeriodsOpen } = require('../accounting/accountingPeriodService');

const PERIOD_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** The JE date of a depreciation month: its last day (noon UTC, so it never shifts a day locally). */
function periodDate(period) {
  const [, year, month] = period.match(PERIOD_PATTERN);
  return new Date(Date.UTC(Number(year), Number(month), 0, 12));
}

/**
 * Creates a Fixed Asset and its acquisition entry (FIXED_ASSET_ACQUISITION) in the caller's
 * transaction:
 *
 *   Dr  the asset's account (Property, Plant & Equipment / Intangible Assets)   cost
 *   Dr  Input VAT (the same account Purchase Orders use)                          VAT
 *       Cr  Suppliers - the vendor (Vendor Number as Sub Account)                 cost + VAT
 *
 * and adds cost + VAT to the vendor's balance, the same way a Purchase Order does. No inventory
 * movement and no payment - the vendor is paid through the existing payment flow.
 */
async function createFixedAsset(input, userId, session) {
  const { name, vendor: vendorId, assetAccountId, accumulatedAccountId, depreciationAccountId, acquisitionDate, price, usefulLifeMonths, vatPercentage, notes } = input;

  const vendorNumber = await resolveVendorNumber(vendorId, { required: true }, session);
  let accounts;
  try {
    accounts = await resolveFixedAssetAccounts({ assetAccount: assetAccountId, accumulatedAccount: accumulatedAccountId, depreciationAccount: depreciationAccountId }, session);
  } catch (err) {
    throw new ApiError(err.message, 400);
  }

  // Closed accounting periods: refused before anything is written (the acquisition entry is
  // checked again when it is saved).
  await assertPeriodsOpen(acquisitionDate, session);

  const cost = round2(Number(price));
  const { vatAmount, total } = computeOrderTotals({ subtotal: cost, vatPercentage });

  const [asset] = await FixedAsset.create(
    [
      {
        assetNumber: await getNextFixedAssetNumber(),
        name,
        vendor: vendorId,
        price: cost,
        bookValue: cost,
        accumulatedDepreciation: 0,
        usefulLifeMonths: Number(usefulLifeMonths),
        vatPercentage: Number(vatPercentage) || 0,
        vatAmount,
        totalAmount: total,
        assetAccountId,
        accumulatedAccountId,
        depreciationAccountId,
        assetClass: accounts.assetClass,
        acquisitionDate,
        notes,
        status: 'active',
        createdBy: userId,
      },
    ],
    { session }
  );

  const lines = [{ account: accounts.assetAccount._id, debit: cost, credit: 0 }];
  if (vatAmount > 0) lines.push({ account: await getAccountIdByCode(AutomaticJournalAccountCodes.inputVat, session), debit: vatAmount, credit: 0 });
  lines.push({ account: await getAccountIdByCode(AutomaticJournalAccountCodes.suppliers, session), debit: 0, credit: total });

  const entry = await postAutomaticJournalEntry({
    accountingAction: 'FIXED_ASSET_ACQUISITION',
    sourceType: 'FIXED_ASSET',
    sourceId: asset._id,
    date: acquisitionDate,
    description: `Fixed asset acquisition - ${name}`,
    lines,
    party: { number: vendorNumber, type: 'vendor' },
    session,
  });

  asset.acquisitionJournalEntry = entry._id;
  await asset.save({ session });
  await Vendor.updateOne({ _id: vendorId }, { $inc: { balance: total } }, { session });
  return asset;
}

/** Non-accounting fields only - the cost, accounts, vendor and life are fixed once posted. */
async function updateFixedAsset(id, { name, notes, status }, session) {
  const asset = await FixedAsset.findById(id).session(session || null);
  if (!asset) throw new ApiError('Fixed asset not found', 404);
  if (name !== undefined) asset.name = name;
  if (notes !== undefined) asset.notes = notes;
  if (status !== undefined) {
    if (!['active', 'under_maintenance', 'disposed'].includes(status)) throw new ApiError(`Status "${status}" cannot be set manually.`, 400);
    // An asset with nothing left to depreciate stays fully depreciated.
    asset.status = status === 'active' && asset.usefulLifeMonths && asset.bookValue <= 0 ? 'fully_depreciated' : status;
  }
  await asset.save({ session });
  return asset;
}

/** 'YYYY-MM' of a date (UTC calendar month). */
const periodOf = date => new Date(date).toISOString().slice(0, 7);

/** Every 'YYYY-MM' from `from` up to and including `to`. */
function monthsBetween(from, to) {
  const out = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

const liveDepreciations = asset => (asset.depreciations || []).filter(d => !d.reversed);

/**
 * Keeps an asset in line with its ledger when one of its depreciation entries is reversed (the
 * standard journal entry reversal, in the caller's transaction): the month's record is marked
 * reversed - it stays for the audit trail - and its amount is added back to the Book Value and taken
 * off accumulated depreciation, so the month counts as not depreciated and can be run again.
 * A no-op for any other entry. Safe to call twice.
 */
async function applyDepreciationReversal(originalEntryId, reversalEntryId, session) {
  const asset = await FixedAsset.findOne({ depreciations: { $elemMatch: { journalEntry: originalEntryId, reversed: { $ne: true } } } }).session(session || null);
  if (!asset) return null;
  const record = asset.depreciations.find(d => String(d.journalEntry) === String(originalEntryId) && !d.reversed);
  const bookValue = round2(asset.bookValue + record.amount);
  const accumulatedDepreciation = round2(Math.max(0, (asset.accumulatedDepreciation || 0) - record.amount));
  await FixedAsset.updateOne(
    { _id: asset._id, depreciations: { $elemMatch: { journalEntry: originalEntryId, reversed: { $ne: true } } } },
    {
      $set: {
        'depreciations.$.reversed': true,
        'depreciations.$.reversedByEntry': reversalEntryId || null,
        bookValue,
        accumulatedDepreciation,
        ...(asset.status === 'fully_depreciated' && bookValue > 0 ? { status: 'active' } : {}),
      },
    },
    { session }
  );
  return { asset: asset._id, period: record.period, amount: record.amount };
}

/**
 * Depreciation entries reversed before applyDepreciationReversal existed left their asset unchanged
 * (the month looked done for ever). Brought in line at the start of every run.
 */
async function syncReversedDepreciations(session) {
  const JournalEntry = require('../../models/accounting/journalEntryModel'); // eslint-disable-line global-require
  const reversed = await JournalEntry.collection
    .find({ accountingAction: 'FIXED_ASSET_DEPRECIATION', status: 'reversed' }, { projection: { _id: 1, reversedByEntry: 1 }, session: session || undefined })
    .toArray();
  if (!reversed.length) return 0;
  const stale = await FixedAsset.find({ depreciations: { $elemMatch: { journalEntry: { $in: reversed.map(e => e._id) }, reversed: { $ne: true } } } })
    .select('_id')
    .session(session || null)
    .lean();
  if (!stale.length) return 0;
  let fixed = 0;
  for (const entry of reversed) {
    // eslint-disable-next-line no-await-in-loop
    if (await applyDepreciationReversal(entry._id, entry.reversedByEntry, session)) fixed += 1;
  }
  return fixed;
}

/**
 * Manual monthly depreciation/amortization run for `period` ('YYYY-MM'), all inside the caller's
 * transaction (any failure rolls the whole run back). Every asset acquired on or before the month is
 * looked at; one that is in use (active or under maintenance - an idle asset still depreciates),
 * has a useful life and its accounts, still has Book Value, and has no live depreciation for the
 * month is depreciated:
 *
 *   amount = cost / useful life in months, capped at the remaining Book Value (the final month
 *            takes exactly what is left, so rounding never leaves a remainder)
 *   Dr  the asset's Depreciation & Amortization account     amount
 *       Cr  its Accumulated Depreciation / Amortization     amount     (FIXED_ASSET_DEPRECIATION)
 *
 * then accumulated depreciation += amount, Book Value -= amount, the month is recorded on the asset
 * (with its entry and run), and an asset reaching 0 becomes 'fully_depreciated'. Every other asset
 * is listed in the run's `skipped` with the reason, and earlier months an asset was never
 * depreciated for are listed in `missingEarlierMonths` - nothing is skipped silently. The result is
 * saved as a FixedAssetDepreciationRun.
 *
 * Never twice: the asset is only updated while the month has no live record and its Book Value is
 * unchanged since it was read, and the entry's source key includes the month. A month whose entry
 * was reversed (applyDepreciationReversal) is depreciated again with a new entry.
 */
async function runDepreciation({ period, userId }, session) {
  if (!PERIOD_PATTERN.test(period || '')) throw new ApiError('The depreciation month must be in YYYY-MM format.', 400);
  const now = new Date();
  const currentPeriod = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  if (period > currentPeriod) throw new ApiError('A future month cannot be depreciated.', 400);

  const date = periodDate(period);
  // A closed month cannot be depreciated (every depreciation entry is checked again when saved).
  await assertPeriodsOpen(date, session);
  const monthEnd = new Date(date);
  monthEnd.setUTCHours(23, 59, 59, 999);

  await syncReversedDepreciations(session);
  const runId = new mongoose.Types.ObjectId();
  const assets = await FixedAsset.find({ acquisitionDate: { $lte: monthEnd } })
    .sort({ acquisitionDate: 1, _id: 1 })
    .session(session || null);

  const processed = [];
  const skipped = [];
  const missingEarlierMonths = [];
  for (const asset of assets) {
    const live = liveDepreciations(asset);
    const done = live.find(d => d.period === period);
    let reason = null;
    if (asset.status === 'disposed') reason = 'Disposed';
    else if (!asset.usefulLifeMonths || !asset.accumulatedAccountId || !asset.depreciationAccountId) reason = 'No useful life or depreciation accounts (an asset created before the Fixed Assets module) - not depreciated';
    else if (done) reason = 'Already depreciated for this month';
    else if (!(asset.bookValue > 0) || asset.status === 'fully_depreciated') reason = 'Fully depreciated';
    if (reason) {
      skipped.push({ asset: asset._id, name: asset.name, reason });
    } else {
      const monthly = round2(asset.price / asset.usefulLifeMonths);
      const isLastMonth = live.length + 1 >= asset.usefulLifeMonths;
      const amount = round2(isLastMonth ? asset.bookValue : Math.min(monthly, asset.bookValue));
      const kind = asset.assetClass === 'intangible' ? 'Amortization' : 'Depreciation';
      // A month depreciated again after its entry was reversed gets a new source key.
      const redone = (asset.depreciations || []).filter(d => d.period === period && d.reversed).length;
      // eslint-disable-next-line no-await-in-loop
      const entry = await postAutomaticJournalEntry({
        accountingAction: 'FIXED_ASSET_DEPRECIATION',
        sourceType: 'FIXED_ASSET',
        sourceId: deterministicSourceId(`${asset._id}:FIXED_ASSET_DEPRECIATION:${period}${redone ? `:${redone}` : ''}`),
        date,
        description: `${kind} - ${asset.name} - ${period}`,
        reference: `Depreciation run ${period} (${runId})`,
        lines: [
          { account: asset.depreciationAccountId._id || asset.depreciationAccountId, debit: amount, credit: 0 },
          { account: asset.accumulatedAccountId._id || asset.accumulatedAccountId, debit: 0, credit: amount },
        ],
        session,
      });

      const bookValue = round2(asset.bookValue - amount);
      const accumulatedDepreciation = round2((asset.accumulatedDepreciation || 0) + amount);
      // eslint-disable-next-line no-await-in-loop
      const { matchedCount } = await FixedAsset.updateOne(
        { _id: asset._id, bookValue: asset.bookValue, depreciations: { $not: { $elemMatch: { period, reversed: { $ne: true } } } } },
        {
          $set: { bookValue, accumulatedDepreciation, status: bookValue <= 0 ? 'fully_depreciated' : asset.status },
          $push: { depreciations: { period, amount, date, journalEntry: entry._id, run: runId, createdBy: userId } },
        },
        { session }
      );
      if (matchedCount !== 1) throw new ApiError(`"${asset.name}" was changed by another request during the depreciation run. Please run it again.`, 409);
      processed.push({ asset: asset._id, name: asset.name, assetClass: asset.assetClass, amount, bookValue, accumulatedDepreciation, journalEntry: entry._id, entryNumber: entry.entryNumber });
      live.push({ period });
    }

    // Earlier months of its life this asset was never depreciated for (each month is its own run).
    if (asset.usefulLifeMonths && asset.status !== 'disposed' && live.length < asset.usefulLifeMonths) {
      const doneMonths = new Set(live.map(d => d.period));
      const firstMonth = periodOf(asset.acquisitionDate);
      const missing = firstMonth < period ? monthsBetween(firstMonth, period).slice(0, -1).filter(m => !doneMonths.has(m)) : [];
      if (missing.length) missingEarlierMonths.push({ asset: asset._id, name: asset.name, periods: missing });
    }
  }

  const result = { period, date, processed, skipped, missingEarlierMonths, totalAmount: round2(processed.reduce((sum, p) => sum + p.amount, 0)) };
  const [run] = await FixedAssetDepreciationRun.create([{ _id: runId, ...result, createdBy: userId }], { session });
  return { ...result, run: run._id };
}

/** The latest depreciation runs, newest first. */
const listDepreciationRuns = (limit = 50) =>
  FixedAssetDepreciationRun.find({}).sort({ createdAt: -1 }).limit(limit).populate({ path: 'createdBy', select: 'name' }).lean();

module.exports = { createFixedAsset, updateFixedAsset, runDepreciation, periodDate, applyDepreciationReversal, syncReversedDepreciations, listDepreciationRuns };
