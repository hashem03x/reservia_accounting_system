const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');
const FixedAsset = require('../models/fixedAssets');
const Payment = require('../models/vendor/paymentModel');
const JournalEntry = require('../models/accounting/journalEntryModel');
const factory = require('./handlersFactory');
const { getNextJournalEntryNumber } = require('../services/accounting/journalEntryNumberService');
const { logAccountingEvent, logAccountingError } = require('../utils/accountingLogger');

// Get all fixed assets
exports.getFixedAssets = factory.getAll(FixedAsset);

// Create new fixed asset
exports.createFixedAsset = asyncHandler(async (req, res) => {
  const { name, bookValue, fairValue, warehouseId, price, assetAccountId, sourceAccountId, acquisitionDate, status, notes } = req.body;
  // bookValue/fairValue keep their historical meaning for the existing sell/loseValue flow - when
  // the caller only sends the new `price` field, both default to it so a newly created asset
  // still behaves correctly in that pre-existing code path without requiring every frontend
  // caller to send three near-duplicate numbers.
  const resolvedBookValue = bookValue ?? price;
  const resolvedFairValue = fairValue ?? price;
  const startedAt = Date.now();

  const session = await mongoose.startSession();
  try {
    let fixedAsset;
    let journalEntry = null;

    await session.withTransaction(async () => {
      [fixedAsset] = await FixedAsset.create(
        [
          {
            name,
            bookValue: resolvedBookValue,
            fairValue: resolvedFairValue,
            warehouseId,
            price,
            assetAccountId: assetAccountId || undefined,
            acquisitionDate,
            status,
            notes,
            createdBy: req.user._id,
          },
        ],
        { session }
      );

      // Create an outgoing payment for the purchase
      await Payment.create(
        [
          {
            warehouseId,
            type: 'out',
            amountPaid: resolvedBookValue,
            paymentMethod: 'cash', // You might want to make this configurable
            paymentCategory: 'purchase',
            notes: `Fixed asset purchase: ${name}`,
            createdBy: req.user._id,
          },
        ],
        { session }
      );

      // Per master spec's "FIXED ASSET ACCOUNTING" section: never invent the credit
      // (source-of-funds) account - only post a journal entry when the caller explicitly supplies
      // both sides (Dr assetAccountId / Cr sourceAccountId). Omitting either leaves the asset
      // exactly as it behaved before this phase (Payment only, no journal entry).
      if (assetAccountId && sourceAccountId) {
        const entryNumber = await getNextJournalEntryNumber(session);
        [journalEntry] = await JournalEntry.create(
          [
            {
              entryNumber,
              date: acquisitionDate || new Date(),
              description: `Fixed asset purchase: ${name}`,
              source: 'fixed_asset_purchase',
              status: 'posted',
              lines: [
                { account: assetAccountId, debit: price, credit: 0, description: `Fixed asset - ${name}` },
                { account: sourceAccountId, debit: 0, credit: price, description: `Source of funds - ${name}` },
              ],
              createdBy: req.user._id,
              postedBy: req.user._id,
              postedAt: new Date(),
            },
          ],
          { session }
        );
      }
    });

    logAccountingEvent('FIXED_ASSET_CREATED', {
      fixedAssetId: fixedAsset._id,
      journalEntryId: journalEntry?._id,
      durationMs: Date.now() - startedAt,
      requestId: req.id,
    });

    res.status(201).json({
      status: 'success',
      data: fixedAsset,
      journalEntry,
    });
  } catch (err) {
    logAccountingError('FIXED_ASSET_CREATION_FAILED', err, {
      durationMs: Date.now() - startedAt,
      mongoErrorCode: err.code,
      mongoErrorLabels: typeof err.errorLabels === 'function' ? err.errorLabels() : err.errorLabels,
      requestId: req.id,
    });
    throw err;
  } finally {
    session.endSession();
  }
});

// Update fixed asset
exports.updateFixedAsset = asyncHandler(async (req, res) => {
  const { id } = req.params;
  // const { name, bookValue, fairValue, warehouseId } = req.body;

  const fixedAsset = await FixedAsset.findByIdAndUpdate(id, req.body, { new: true, runValidators: true });

  if (!fixedAsset) {
    res.status(404);
    throw new Error('Fixed asset not found');
  }

  res.status(200).json({
    status: 'success',
    data: fixedAsset,
  });
});

// Sell fixed asset
exports.sellFixedAsset = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const fixedAsset = await FixedAsset.findById(id);

  if (!fixedAsset) {
    res.status(404);
    throw new Error('Fixed asset not found');
  }

  // Create an incoming payment for the sale
  await Payment.create({
    warehouseId: fixedAsset.warehouseId,
    type: 'in',
    amountPaid: fixedAsset.fairValue,
    paymentMethod: 'cash',
    paymentCategory: 'sales',
    notes: `Fixed asset sale: ${fixedAsset.name}`,
    createdBy: req.user._id,
  });

  // Delete the fixed asset
  await FixedAsset.findByIdAndDelete(id);

  res.status(200).json({
    status: 'success',
    message: 'Fixed asset sold and deleted successfully',
  });
});
