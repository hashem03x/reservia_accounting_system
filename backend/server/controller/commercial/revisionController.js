const asyncHandler = require('express-async-handler');
const CommercialRevision = require('../../models/commercial/commercialRevisionModel');
const ApiError = require('../../utils/apiError');
const apiResponse = require('../../utils/apiResponse');
const revisionService = require('../../services/commercial/revisionService');
const { waitingOn } = require('../../services/commercial/approvalService');

const STAGE_POPULATE = ['stage1.approver', 'stage2.approver', 'md.approver'].map(path => ({ path, select: 'name' }));

function withWaitingOn(revision) {
  const data = revision.toObject();
  data.waitingOn = waitingOn(revision);
  return data;
}

exports.getRevision = asyncHandler(async (req, res, next) => {
  const revision = await CommercialRevision.findById(req.params.id).populate(STAGE_POPULATE);
  if (!revision) return next(new ApiError('Revision not found.', 404));
  res.status(200).json(apiResponse('Revision retrieved successfully', true, withWaitingOn(revision)));
});

/**
 * Recomputes the CURRENT revision's engineering/BOQ/pricing from new inputs - resets any already-
 * signed-off stage per the re-approval rule. `applyCurrentConfig: true` re-prices the revision with
 * the CURRENT Finance pricing configuration (an explicit user action; otherwise the revision keeps
 * the levers it was priced with).
 */
exports.recomputeRevision = asyncHandler(async (req, res) => {
  const { engineeringInput, manualOverrides, pricingOverrides, applyCurrentConfig } = req.body;
  const revision = await revisionService.recomputeCurrentRevision(req.params.id, engineeringInput, {
    manualOverrides, pricingOverrides, applyCurrentConfig: applyCurrentConfig === true, userId: req.user._id,
  });
  res.status(200).json(apiResponse('Revision recomputed successfully', true, withWaitingOn(revision)));
});

/** Creates a brand-new revision (never edits a previous one) against the same project. */
exports.createRevisionForProject = asyncHandler(async (req, res) => {
  const { engineeringInput, manualOverrides, pricingOverrides } = req.body;
  const revision = await revisionService.createRevision(req.params.projectId, engineeringInput, { manualOverrides, pricingOverrides, userId: req.user._id });
  res.status(201).json(apiResponse('Revision created successfully', true, withWaitingOn(revision)));
});
