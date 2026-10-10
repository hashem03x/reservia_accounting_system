const FixedAsset = require('../../models/fixedAssets');
const JournalEntry = require('../../models/accounting/journalEntryModel');
const ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
const Payment = require('../../models/vendor/paymentModel');
// Payment's save hook looks these models up by name - make sure they are registered.
require('../../models/vendor/purchaseOrder');
require('../../models/userModel');
const ApiError = require('../../utils/apiError');
const { round2 } = require('../../utils/orderTotals');
const { AutomaticJournalAccountCodes, isPaymentAccountEligible } = require('../../utils/accountingConstants');
const { postAutomaticJournalEntry, getAccountIdByCode, resolveVendorNumber } = require('../accounting/accountingEventService');
const { assertPeriodsOpen } = require('../accounting/accountingPeriodService');
const { formatAssetNumber } = require('./fixedAssetNumberService');

// Payments against a fixed asset's acquisition payable.
//
// The acquisition entry (fixedAssetService.js#createFixedAsset) already capitalizes the asset and
// credits Suppliers (the vendor) with cost + VAT. A payment only settles that payable:
//
//   Dr  Suppliers - the vendor (Vendor Number as Sub Account)   amount
//       Cr  the payment account (Cash / Cash Equivalent)        amount   (FIXED_ASSET_PAYMENT_RECORDED)
//
// Nothing here stores a running "paid" total. What is owed and what is paid are read from the
// ledger every time: payable = the acquisition entry's credit to Suppliers while that entry is
// posted; paid = the payments whose own entry is still posted. A payment reversed through the
// existing journal entry reversal therefore stops counting automatically.

const isZero = n => Math.abs(n) < 0.005;
const idOf = ref => (ref?._id || ref ? String(ref?._id || ref) : null);

/**
 * The asset's payment position: { payable, totalPaid, outstanding, status, review, payments }.
 * status: 'unpaid' | 'partially_paid' | 'paid' | 'not_applicable' (no payable to pay).
 */
/** The acquisition and payment entries of the given assets, in one query: Map id -> entry. */
async function loadPositionEntries(assets, session) {
  const entryIds = assets.flatMap(asset => [asset.acquisitionJournalEntry, ...(asset.payments || []).map(p => p.journalEntry)]).map(idOf).filter(Boolean);
  const entries = entryIds.length
    ? await JournalEntry.find({ _id: { $in: entryIds } })
        .select('entryNumber status reversedByEntry lines.account lines.credit')
        .populate({ path: 'reversedByEntry', select: 'entryNumber date' })
        .session(session || null)
        .lean()
    : [];
  return new Map(entries.map(e => [String(e._id), e]));
}

async function paymentPosition(asset, session, preloadedEntries = null) {
  const payments = asset.payments || [];
  const entryById = preloadedEntries || (await loadPositionEntries([asset], session));

  let payable = null;
  let review = null;
  const acquisition = entryById.get(idOf(asset.acquisitionJournalEntry));
  if (!asset.acquisitionJournalEntry) {
    review = 'This asset has no acquisition journal entry (it predates the Fixed Assets module), so no vendor payable was recorded for it. Payments cannot be recorded until its acquisition is reviewed.';
  } else if (!acquisition) {
    review = 'The acquisition journal entry of this asset was not found. Payments cannot be recorded until its acquisition is reviewed.';
  } else if (acquisition.status !== 'posted') {
    payable = 0;
    review = `The acquisition entry #${acquisition.entryNumber} has been reversed, so nothing is owed to the vendor for this asset.`;
  } else {
    const suppliersId = String(await getAccountIdByCode(AutomaticJournalAccountCodes.suppliers, session));
    payable = round2(acquisition.lines.filter(l => idOf(l.account) === suppliersId).reduce((s, l) => s + (l.credit || 0), 0));
    if (!(payable > 0)) review = 'The acquisition entry does not credit Suppliers, so the asset was not bought on credit and there is nothing to pay.';
  }

  const rows = payments.map(p => {
    const entry = entryById.get(idOf(p.journalEntry));
    const status = entry?.status === 'posted' ? 'posted' : entry?.status === 'reversed' ? 'reversed' : 'missing_entry';
    return { payment: p, entry, status };
  });
  const totalPaid = round2(rows.filter(r => r.status === 'posted').reduce((s, r) => s + r.payment.amount, 0));
  let outstanding = payable === null ? null : round2(payable - totalPaid);
  if (outstanding !== null && isZero(outstanding)) outstanding = 0;

  let status;
  if (!(payable > 0)) status = 'not_applicable';
  else if (outstanding <= 0) status = 'paid';
  else if (totalPaid > 0) status = 'partially_paid';
  else status = 'unpaid';
  if (outstanding !== null && outstanding < 0) review = `The posted payments exceed what is owed by ${round2(-outstanding)} - review the acquisition and payment entries.`;

  return { payable, totalPaid, outstanding, status, review, rows };
}

/** The asset with its payment summary and history (newest first) - read-only. */
async function getFixedAssetPayments(assetId) {
  const asset = await FixedAsset.findById(assetId).populate({ path: 'payments.paymentAccount', select: 'code name nameAr' }).populate({ path: 'payments.createdBy', select: 'name' }).populate({ path: 'payments.payment', select: 'paymentCategory warehouseId' });
  if (!asset) throw new ApiError('Fixed asset not found', 404);
  const position = await paymentPosition(asset);
  const vendor = asset.vendor ? { _id: asset.vendor._id, name: asset.vendor.name, vendorNumber: asset.vendor.vendorNumber ?? null } : null;
  const payments = position.rows
    .map(({ payment: p, entry, status }) => ({
      _id: p._id,
      payment: idOf(p.payment),
      date: p.date,
      amount: p.amount,
      currency: 'EGP',
      paymentAccount: p.paymentAccount,
      vendor,
      reference: p.reference || null,
      notes: p.notes || null,
      status,
      journalEntry: entry ? { _id: entry._id, entryNumber: entry.entryNumber } : idOf(p.journalEntry),
      reversalEntry: entry?.reversedByEntry ? { _id: entry.reversedByEntry._id, entryNumber: entry.reversedByEntry.entryNumber, date: entry.reversedByEntry.date } : null,
      createdBy: p.createdBy?.name ? { _id: p.createdBy._id, name: p.createdBy.name } : null,
      createdAt: p.createdAt,
    }))
    .sort((a, b) => new Date(b.date) - new Date(a.date) || new Date(b.createdAt) - new Date(a.createdAt));

  return {
    asset: { _id: asset._id, name: asset.name, assetClass: asset.assetClass, acquisitionDate: asset.acquisitionDate, vendor, acquisitionJournalEntry: idOf(asset.acquisitionJournalEntry) },
    summary: {
      acquisitionCost: asset.price ?? null,
      vatAmount: asset.vatAmount ?? 0,
      payable: position.payable,
      totalPaid: position.totalPaid,
      outstanding: position.outstanding,
      status: position.status,
      review: position.review,
      currency: 'EGP',
    },
    payments,
  };
}

/**
 * Records a payment to the asset's vendor, in the caller's transaction: a Payment (category
 * 'fixed-asset' - its own hooks update the warehouse and vendor balances, like every vendor
 * payment), the FIXED_ASSET_PAYMENT_RECORDED entry, and the asset's payment record.
 *
 * Never more than is still owed. The asset is only updated if no other payment was saved since the
 * outstanding amount was read (paymentRevision), so a concurrent request cannot overpay, and a
 * repeated submission (same requestKey) returns the payment already recorded.
 */
async function recordFixedAssetPayment(assetId, input, userId, session) {
  const { amount, paymentAccount, warehouseId, date, reference, notes, vendor: vendorInput, requestKey } = input;
  const asset = await FixedAsset.findById(assetId).session(session || null);
  if (!asset) throw new ApiError('Fixed asset not found', 404);

  if (requestKey) {
    const existing = asset.payments.find(p => p.requestKey === requestKey);
    if (existing) return { asset, payment: existing, duplicate: true };
  }

  const vendorId = idOf(asset.vendor);
  if (!vendorId) throw new ApiError('This asset has no vendor, so there is no payable to pay.', 400);
  if (vendorInput && String(vendorInput) !== vendorId) throw new ApiError('The vendor does not match the asset\'s vendor.', 400);

  const position = await paymentPosition(asset, session);
  if (position.payable === null) throw new ApiError(position.review, 400);
  if (position.status === 'not_applicable') throw new ApiError(position.review || 'Nothing is owed for this asset.', 400);
  if (!(position.outstanding > 0)) throw new ApiError('This asset is fully paid - no outstanding balance remains.', 400);

  const value = round2(Number(amount));
  if (!(value > 0)) throw new ApiError('Payment amount must be greater than 0.', 400);
  if (value > position.outstanding) throw new ApiError(`Payment amount (${value}) exceeds the outstanding amount (${position.outstanding}).`, 400);

  if (!date) throw new ApiError('Payment date is required.', 400);
  const paymentDate = new Date(date);
  if (Number.isNaN(paymentDate.getTime())) throw new ApiError('Invalid payment date.', 400);
  if (asset.acquisitionDate && paymentDate.toISOString().slice(0, 10) < new Date(asset.acquisitionDate).toISOString().slice(0, 10)) {
    throw new ApiError('The payment date cannot be before the asset date.', 400);
  }
  await assertPeriodsOpen(paymentDate, session);

  if (!paymentAccount) throw new ApiError('Payment method is required.', 400);
  const account = await ChartOfAccount.findById(paymentAccount).session(session || null).lean();
  if (!isPaymentAccountEligible(account)) throw new ApiError('The payment method must be a Cash or Cash Equivalent account.', 400);

  const vendorNumber = await resolveVendorNumber(vendorId, { required: true }, session);
  const text = reference ? `${asset.name} (${reference})` : asset.name;

  const [payment] = await Payment.create(
    [
      {
        warehouseId,
        type: 'out',
        amountPaid: value,
        paymentAccount: account._id,
        paymentCategory: 'fixed-asset',
        vendorId,
        notes: notes || `Fixed asset payment - ${text}`,
        createdBy: userId,
      },
    ],
    { session }
  );

  const entry = await postAutomaticJournalEntry({
    accountingAction: 'FIXED_ASSET_PAYMENT_RECORDED',
    sourceType: 'PAYMENT',
    sourceId: payment._id,
    date: paymentDate,
    description: notes?.trim() || `Fixed asset payment - ${text}`,
    lines: [
      { account: await getAccountIdByCode(AutomaticJournalAccountCodes.suppliers, session), debit: value, credit: 0 },
      { account: account._id, debit: 0, credit: value },
    ],
    party: { number: vendorNumber, type: 'vendor' },
    session,
  });

  const record = { payment: payment._id, amount: value, paymentAccount: account._id, date: paymentDate, reference, notes, journalEntry: entry._id, requestKey: requestKey || undefined, createdBy: userId };
  const revision = asset.paymentRevision || 0;
  const { matchedCount } = await FixedAsset.updateOne(
    { _id: asset._id, paymentRevision: revision === 0 ? { $in: [0, null] } : revision },
    { $inc: { paymentRevision: 1 }, $push: { payments: record } },
    { session }
  );
  if (matchedCount !== 1) throw new ApiError('Another payment was recorded for this asset at the same time. Please refresh and try again.', 409);
  return { asset, payment: record, journalEntry: entry, duplicate: false };
}

/**
 * Every fixed asset acquired from a vendor, for the vendor's page: acquisition date, asset number
 * and name, amount owed (the acquisition entry's credit to Suppliers), paid, outstanding, status,
 * the acquisition entry and each payment's entry and reference. Read from the same ledger figures
 * as the asset's Payments tab - one query for all of the vendor's entries, nothing re-computed.
 */
async function vendorFixedAssetAcquisitions(vendorId) {
  const assets = await FixedAsset.find({ vendor: vendorId }).sort({ acquisitionDate: -1, createdAt: -1 });
  const entryById = await loadPositionEntries(assets);
  const rows = [];
  for (const asset of assets) {
    // eslint-disable-next-line no-await-in-loop
    const position = await paymentPosition(asset, null, entryById);
    const acquisition = entryById.get(idOf(asset.acquisitionJournalEntry)) || null;
    rows.push({
      _id: asset._id,
      assetNumber: formatAssetNumber(asset.assetNumber),
      name: asset.name,
      assetClass: asset.assetClass,
      acquisitionDate: asset.acquisitionDate,
      projectNumber: null,
      cost: asset.price ?? null,
      vatAmount: asset.vatAmount ?? 0,
      acquisitionAmount: position.payable,
      currency: 'EGP',
      totalPaid: position.totalPaid,
      outstanding: position.outstanding,
      status: position.status,
      review: position.review,
      acquisitionJournalEntry: acquisition ? { _id: acquisition._id, entryNumber: acquisition.entryNumber, status: acquisition.status } : null,
      payments: position.rows.map(({ payment, entry, status }) => ({
        date: payment.date,
        amount: payment.amount,
        reference: payment.reference || null,
        status,
        journalEntry: entry ? { _id: entry._id, entryNumber: entry.entryNumber } : null,
      })),
    });
  }
  return rows;
}

module.exports = { paymentPosition, getFixedAssetPayments, recordFixedAssetPayment, vendorFixedAssetAcquisitions };
