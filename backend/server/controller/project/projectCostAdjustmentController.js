const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');
const apiResponse = require('../../utils/apiResponse');
const { logAccountingEvent } = require('../../utils/accountingLogger');
const { costAdjustmentPreview, prepareCostAdjustment } = require('../../services/project/projectCostEstimateService');

// GET /projects/:id/cost-adjustment - the end-of-project PUC cost adjustment, line by line (nothing posted).
exports.getCostAdjustment = asyncHandler(async (req, res) => {
  res.status(200).json(apiResponse('Cost adjustment calculated', true, await costAdjustmentPreview(req.params.id)));
});

// POST /projects/:id/cost-adjustment { date } - creates it as a DRAFT journal entry, to be reviewed and
// posted through the Journal Entries workflow.
exports.createCostAdjustment = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  try {
    let entry;
    await session.withTransaction(async () => {
      entry = await prepareCostAdjustment(req.params.id, { date: req.body?.date, userId: req.user._id }, session);
    });
    logAccountingEvent('PUC_COST_ADJUSTMENT_DRAFTED', { projectId: req.params.id, journalEntryId: entry._id, entryNumber: entry.entryNumber, requestId: req.id });
    res.status(201).json(apiResponse('Cost adjustment draft created', true, entry));
  } finally {
    session.endSession();
  }
});
