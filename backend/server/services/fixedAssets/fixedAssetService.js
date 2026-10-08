const FixedAsset = require('../../models/fixedAssets');
const Vendor = require('../../models/vendor/vendor');
const ApiError = require('../../utils/apiError');
const { computeOrderTotals, round2 } = require('../../utils/orderTotals');
const { AutomaticJournalAccountCodes } = require('../../utils/accountingConstants');
const { postAutomaticJournalEntry, getAccountIdByCode, resolveVendorNumber, deterministicSourceId } = require('../accounting/accountingEventService');
const { resolveFixedAssetAccounts } = require('./fixedAssetAccounts');

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

  const cost = round2(Number(price));
  const { vatAmount, total } = computeOrderTotals({ subtotal: cost, vatPercentage });

  const [asset] = await FixedAsset.create(
    [
      {
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

/**
 * Manual monthly depreciation/amortization run for `period` ('YYYY-MM'), all inside the caller's
 * transaction (any failure rolls the whole run back). For every active asset whose Asset Date is
 * on or before that month, that still has Book Value, and that has not been depreciated for that
 * month yet:
 *
 *   amount = cost / useful life in months, capped at the remaining Book Value (the final month
 *            takes exactly what is left, so rounding never leaves a remainder)
 *   Dr  Depreciation & Amortization       amount
 *       Cr  Accumulated Depreciation / Amortization   amount     (FIXED_ASSET_DEPRECIATION)
 *
 * then accumulated depreciation += amount, Book Value -= amount, the month is recorded on the
 * asset, and an asset reaching 0 becomes 'fully_depreciated'. Duplicates are impossible: the month
 * is part of the entry's source key, and the asset is only updated if that month is still absent
 * and its Book Value is unchanged since it was read.
 */
async function runDepreciation({ period, userId }, session) {
  if (!PERIOD_PATTERN.test(period || '')) throw new ApiError('The depreciation month must be in YYYY-MM format.', 400);
  const now = new Date();
  const currentPeriod = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  if (period > currentPeriod) throw new ApiError('A future month cannot be depreciated.', 400);

  const date = periodDate(period);
  const monthEnd = new Date(date);
  monthEnd.setUTCHours(23, 59, 59, 999);

  const candidates = await FixedAsset.find({
    status: 'active',
    usefulLifeMonths: { $gt: 0 },
    bookValue: { $gt: 0 },
    accumulatedAccountId: { $ne: null },
    depreciationAccountId: { $ne: null },
    acquisitionDate: { $lte: monthEnd },
    'depreciations.period': { $ne: period },
  })
    .sort({ acquisitionDate: 1, _id: 1 })
    .session(session || null);

  const processed = [];
  for (const asset of candidates) {
    const monthly = round2(asset.price / asset.usefulLifeMonths);
    const isLastMonth = asset.depreciations.length + 1 >= asset.usefulLifeMonths;
    const amount = round2(isLastMonth ? asset.bookValue : Math.min(monthly, asset.bookValue));
    if (amount > 0) {
      const kind = asset.assetClass === 'intangible' ? 'Amortization' : 'Depreciation';
      // eslint-disable-next-line no-await-in-loop
      const entry = await postAutomaticJournalEntry({
        accountingAction: 'FIXED_ASSET_DEPRECIATION',
        sourceType: 'FIXED_ASSET',
        sourceId: deterministicSourceId(`${asset._id}:FIXED_ASSET_DEPRECIATION:${period}`),
        date,
        description: `${kind} - ${asset.name} - ${period}`,
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
        { _id: asset._id, bookValue: asset.bookValue, 'depreciations.period': { $ne: period } },
        {
          $set: { bookValue, accumulatedDepreciation, status: bookValue <= 0 ? 'fully_depreciated' : asset.status },
          $push: { depreciations: { period, amount, date, journalEntry: entry._id, createdBy: userId } },
        },
        { session }
      );
      if (matchedCount !== 1) throw new ApiError(`"${asset.name}" was changed by another request during the depreciation run. Please run it again.`, 409);
      processed.push({ asset: asset._id, name: asset.name, amount, bookValue, accumulatedDepreciation, journalEntry: entry._id, entryNumber: entry.entryNumber });
    }
  }

  return { period, date, processed, totalAmount: round2(processed.reduce((sum, p) => sum + p.amount, 0)) };
}

module.exports = { createFixedAsset, updateFixedAsset, runDepreciation, periodDate };
