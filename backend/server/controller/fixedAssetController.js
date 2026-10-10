const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');
const FixedAsset = require('../models/fixedAssets');
const factory = require('./handlersFactory');
const ApiError = require('../utils/apiError');
const { logAccountingEvent, logAccountingError } = require('../utils/accountingLogger');
const { createFixedAsset, updateFixedAsset, runDepreciation, listDepreciationRuns } = require('../services/fixedAssets/fixedAssetService');
const { getFixedAssetAccountOptions } = require('../services/fixedAssets/fixedAssetAccounts');
const { getFixedAssetPayments, recordFixedAssetPayment } = require('../services/fixedAssets/fixedAssetPaymentService');

// Runs `work(session)` in one MongoDB transaction - the asset/depreciation records and their
// journal entries commit together or not at all.
async function inTransaction(work) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } finally {
    session.endSession();
  }
}

exports.getFixedAssets = factory.getAll(FixedAsset);

exports.getFixedAsset = asyncHandler(async (req, res, next) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) return next(new ApiError('Invalid fixed asset id', 400));
  const asset = await FixedAsset.findById(req.params.id)
    .populate({ path: 'createdBy', select: 'name' })
    .populate({ path: 'acquisitionJournalEntry depreciations.journalEntry', select: 'entryNumber' });
  if (!asset) return next(new ApiError('Fixed asset not found', 404));
  res.status(200).json({ status: 'success', data: asset });
});

// The accounts the Fixed Asset form may offer, from the Chart of Accounts groups.
exports.getFixedAssetAccountOptions = asyncHandler(async (req, res) => {
  res.status(200).json({ status: 'success', data: await getFixedAssetAccountOptions() });
});

exports.createFixedAsset = asyncHandler(async (req, res) => {
  const startedAt = Date.now();
  try {
    const asset = await inTransaction(session => createFixedAsset(req.body, req.user._id, session));
    logAccountingEvent('FIXED_ASSET_CREATED', { fixedAssetId: asset._id, journalEntryId: asset.acquisitionJournalEntry, durationMs: Date.now() - startedAt, requestId: req.id });
    res.status(201).json({ status: 'success', data: await FixedAsset.findById(asset._id) });
  } catch (err) {
    logAccountingError('FIXED_ASSET_CREATION_FAILED', err, { durationMs: Date.now() - startedAt, requestId: req.id });
    throw err;
  }
});

exports.updateFixedAsset = asyncHandler(async (req, res) => {
  const asset = await inTransaction(session => updateFixedAsset(req.params.id, req.body, session));
  res.status(200).json({ status: 'success', data: await FixedAsset.findById(asset._id) });
});

// POST /fixed-assets/depreciation/run { period: 'YYYY-MM' }
exports.runDepreciation = asyncHandler(async (req, res) => {
  const startedAt = Date.now();
  try {
    const result = await inTransaction(session => runDepreciation({ period: req.body.period, userId: req.user._id }, session));
    logAccountingEvent('FIXED_ASSET_DEPRECIATION_RUN', { period: result.period, assets: result.processed.length, totalAmount: result.totalAmount, durationMs: Date.now() - startedAt, requestId: req.id });
    res.status(200).json({ status: 'success', data: result });
  } catch (err) {
    logAccountingError('FIXED_ASSET_DEPRECIATION_RUN_FAILED', err, { period: req.body.period, durationMs: Date.now() - startedAt, requestId: req.id });
    throw err;
  }
});

// GET /fixed-assets/:id/payments - payment summary (from the ledger) and history, newest first.
exports.getFixedAssetPayments = asyncHandler(async (req, res, next) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) return next(new ApiError('Invalid fixed asset id', 400));
  res.status(200).json({ status: 'success', data: await getFixedAssetPayments(req.params.id) });
});

// POST /fixed-assets/:id/payments - the Payment, its journal entry and the asset's payment record
// commit together or not at all.
exports.recordFixedAssetPayment = asyncHandler(async (req, res) => {
  const startedAt = Date.now();
  try {
    const result = await inTransaction(session => recordFixedAssetPayment(req.params.id, req.body, req.user._id, session));
    if (!result.duplicate) logAccountingEvent('FIXED_ASSET_PAYMENT_RECORDED', { fixedAssetId: req.params.id, paymentId: result.payment.payment, journalEntryId: result.payment.journalEntry, amount: result.payment.amount, durationMs: Date.now() - startedAt, requestId: req.id });
    res.status(result.duplicate ? 200 : 201).json({ status: 'success', data: await getFixedAssetPayments(req.params.id) });
  } catch (err) {
    logAccountingError('FIXED_ASSET_PAYMENT_FAILED', err, { fixedAssetId: req.params.id, durationMs: Date.now() - startedAt, requestId: req.id });
    throw err;
  }
});

// GET /fixed-assets/depreciation/runs - the latest depreciation runs and their results.
exports.getDepreciationRuns = asyncHandler(async (req, res) => {
  res.status(200).json({ status: 'success', data: await listDepreciationRuns() });
});
