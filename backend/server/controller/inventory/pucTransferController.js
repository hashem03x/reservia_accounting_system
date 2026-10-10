const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');
const apiResponse = require('../../utils/apiResponse');
const { logAccountingEvent, logAccountingError } = require('../../utils/accountingLogger');
const { recordPucTransfer, transferOptions, listTransfers } = require('../../services/inventory/pucTransferService');

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

// GET /puc-transfers/product/:productId/options?sourceProject= - warehouse stock, the cost still in
// Materials Inventory and (when asked) what a project can give.
exports.getPucTransferOptions = asyncHandler(async (req, res) => {
  res.status(200).json(apiResponse('PUC transfer options retrieved successfully', true, await transferOptions(req.params.productId, { sourceProject: req.query.sourceProject })));
});

// GET /puc-transfers/product/:productId - the product's transfers, newest first.
exports.getProductPucTransfers = asyncHandler(async (req, res) => {
  res.status(200).json(apiResponse('PUC transfers retrieved successfully', true, await listTransfers(req.params.productId)));
});

// POST /puc-transfers/product/:productId - stock, transfer record and journal entry in one transaction.
exports.createPucTransfer = asyncHandler(async (req, res) => {
  const startedAt = Date.now();
  try {
    const result = await inTransaction(session => recordPucTransfer(req.params.productId, req.body, req.user._id, session));
    if (!result.duplicate) logAccountingEvent('PUC_TRANSFER_RECORDED', { pucTransferId: result.transfer._id, journalEntryId: result.transfer.journalEntry, amount: result.transfer.amount, durationMs: Date.now() - startedAt, requestId: req.id });
    res.status(result.duplicate ? 200 : 201).json(apiResponse('PUC transfer recorded successfully', true, result.transfer));
  } catch (err) {
    logAccountingError('PUC_TRANSFER_FAILED', err, { productId: req.params.productId, durationMs: Date.now() - startedAt, requestId: req.id });
    throw err;
  }
});
