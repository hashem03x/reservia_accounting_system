const asyncHandler = require('express-async-handler');
const apiResponse = require('../../utils/apiResponse');
const approvalService = require('../../services/commercial/approvalService');
const { assertCanAccessApprovals, canSeePricing, shapeRevisionForRole } = require('../../utils/commercial/dealEnginePermissions');

// R2/R12: Approvals is Hidden to Procurement (A12 lists Overview/BOQ/Materials/Suppliers for
// procurement, never Approvals). WHO may sign a given stage was already correctly enforced inside
// approvalService.js#setStageStatus (against req.commercialRole) before this change - that
// stage-by-stage role check is untouched; this only adds the "can this role see Approvals at all"
// gate neither function had.
exports.setStageStatus = asyncHandler(async (req, res) => {
  assertCanAccessApprovals(req.commercialRoles);
  const { status, note, expectedCalculatedAt } = req.body;
  // Roles come from the authenticated user's own Commercial memberships (commercialAccess.js) - never the request.
  const revision = await approvalService.setStageStatus(req.params.id, req.params.stage.toUpperCase(), status, {
    userId: req.user._id, userRole: req.commercialRole, roles: req.commercialRoles, note, expectedCalculatedAt, actor: req.user,
  });
  // Pricing confidentiality: a Technical approver gets the revision without any money.
  res.status(200).json(apiResponse('Approval stage updated successfully', true, shapeRevisionForRole(revision, req.commercialRoles)));
});

/** The 3-stage workflow of one revision for the Approvals tab: stages, who may act, and the deal's approval timeline. */
exports.getWorkflow = asyncHandler(async (req, res) => {
  assertCanAccessApprovals(req.commercialRoles);
  const view = await approvalService.getWorkflowView(req.params.id, { userId: req.user._id, roles: req.commercialRoles });
  res.status(200).json(apiResponse('Approval workflow', true, view));
});

exports.getApprovalLog = asyncHandler(async (req, res) => {
  assertCanAccessApprovals(req.commercialRoles);
  const log = await approvalService.getApprovalLog(req.params.id);
  // Go-live Developer Pack section 5.4: Technical Engineer can open Approvals (Stage 1 is
  // theirs to sign) but "must never... see gross profit" - each log row's valueSnapshot carries
  // the exact net price and GP%, which this endpoint returned to EVERY role that could reach
  // Approvals at all, with no redaction. Same gate as the Overview tab's price section.
  const shaped = canSeePricing(req.commercialRoles) ? log : log.map(entry => ({ ...entry.toObject(), valueSnapshot: undefined }));
  res.status(200).json(apiResponse('Approval log retrieved successfully', true, shaped));
});
