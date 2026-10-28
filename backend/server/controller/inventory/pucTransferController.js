const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');
const apiResponse = require('../../utils/apiResponse');
const { logAccountingEvent, logAccountingError } = require('../../utils/accountingLogger');
const { recordPucTransfer, transferOptions, listTransfers, listProjectInventory } = require('../../services/inventory/pucTransferService');
const { getPucRawMaterialBalances, getProjectMaterialBreakdown } = require('../../services/inventory/pucMaterialBalanceService');

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

// GET /puc-transfers/project/:projectId - the project-oriented inventory view (docs section
// "Inventory / Warehouses - Detailed PUC and Raw Materials Per Project").
exports.getProjectInventory = asyncHandler(async (req, res) => {
  const { category, brand, product, page, limit } = req.query;
  res.status(200).json(apiResponse('Project inventory retrieved successfully', true, await listProjectInventory(req.params.projectId, { category, brand, product, page, limit })));
});

// POST /puc-transfers/product/:productId - stock, transfer record and journal entry in one transaction.
// GET /puc-transfers/balances - Warehouses -> PUC - Raw Materials: balances per project x material
// (services/inventory/pucMaterialBalanceService.js). Read-only.
exports.getPucBalances = asyncHandler(async (req, res) => {
  const { project, product, warehouse, dateFrom, dateTo, keyword } = req.query;
  res.status(200).json(apiResponse('PUC raw material balances retrieved successfully', true, await getPucRawMaterialBalances({ project, product, warehouse, dateFrom, dateTo, keyword })));
});

// GET /puc-transfers/project/:projectId/materials - a project's raw materials item by item, with
// the source documents of their cost and, separately, what is ordered on Purchase Orders.
exports.getProjectMaterials = asyncHandler(async (req, res) => {
  res.status(200).json(apiResponse('Project raw materials retrieved successfully', true, await getProjectMaterialBreakdown(req.params.projectId)));
});

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
