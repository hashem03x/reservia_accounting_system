const asyncHandler = require('express-async-handler');
const CommercialRevision = require('../../models/commercial/commercialRevisionModel');
const ApiError = require('../../utils/apiError');
const apiResponse = require('../../utils/apiResponse');
const revisionService = require('../../services/commercial/revisionService');
const { waitingOn } = require('../../services/commercial/approvalService');
const { shapeRevisionForRole, assertEngineeringInputWriteAllowed, assertPricingWriteAllowed } = require('../../utils/commercial/dealEnginePermissions');

const STAGE_POPULATE = ['stage1.approver', 'stage2.approver', 'md.approver'].map(path => ({ path, select: 'name' }));

function withWaitingOn(revision) {
  const data = revision.toObject();
  data.waitingOn = waitingOn(revision);
  return data;
}

// R12: pricing/feasibility/BOQ-cost fields are stripped from the response for roles the tab
// matrix hides them from (Technical/Procurement/Member for Pricing and Feasibility; Procurement/
// Member for BOQ costs) - see dealEnginePermissions.js#shapeRevisionForRole.
exports.getRevision = asyncHandler(async (req, res, next) => {
  const revision = await CommercialRevision.findById(req.params.id).populate(STAGE_POPULATE);
  if (!revision) return next(new ApiError('Revision not found.', 404));
  res.status(200).json(apiResponse('Revision retrieved successfully', true, shapeRevisionForRole(withWaitingOn(revision), req.commercialRoles)));
});

/**
 * Recomputes the CURRENT revision's engineering/BOQ/pricing from new inputs - resets any already-
 * signed-off stage per the re-approval rule. `applyCurrentConfig: true` re-prices the revision with
 * the CURRENT Finance pricing configuration (an explicit user action; otherwise the revision keeps
 * the levers it was priced with).
 *
 * R3/R9/R12: this is the ONE write endpoint for engineering input, manual overrides and pricing
 * together (there is no separate "edit pricing" endpoint) - so the field-level gate has to inspect
 * THIS request's specific keys, not just the route. A Sales user sending overheadPct, or a
 * Technical user sending a customer feasibility key, is refused with a 403 naming the field -
 * never silently accepted and never only hidden in the browser (A3/A8: a direct API request must
 * be refused exactly like the UI would refuse it).
 */
exports.recomputeRevision = asyncHandler(async (req, res) => {
  const { engineeringInput, manualOverrides, pricingOverrides, applyCurrentConfig } = req.body;
  assertEngineeringInputWriteAllowed(req.commercialRoles, engineeringInput);
  assertPricingWriteAllowed(req.commercialRoles, pricingOverrides);
  const revision = await revisionService.recomputeCurrentRevision(req.params.id, engineeringInput, {
    manualOverrides, pricingOverrides, applyCurrentConfig: applyCurrentConfig === true, userId: req.user._id,
  });
  res.status(200).json(apiResponse('Revision recomputed successfully', true, shapeRevisionForRole(withWaitingOn(revision), req.commercialRoles)));
});

/** Creates a brand-new revision (never edits a previous one) against the same project. Same field-level gate as recompute above. */
exports.createRevisionForProject = asyncHandler(async (req, res) => {
  const { engineeringInput, manualOverrides, pricingOverrides } = req.body;
  assertEngineeringInputWriteAllowed(req.commercialRoles, engineeringInput);
  assertPricingWriteAllowed(req.commercialRoles, pricingOverrides);
  const revision = await revisionService.createRevision(req.params.projectId, engineeringInput, { manualOverrides, pricingOverrides, userId: req.user._id });
  res.status(201).json(apiResponse('Revision created successfully', true, shapeRevisionForRole(withWaitingOn(revision), req.commercialRoles)));
});
