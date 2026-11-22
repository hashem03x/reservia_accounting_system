const asyncHandler = require('express-async-handler');
const apiResponse = require('../../utils/apiResponse');
const approvalService = require('../../services/commercial/approvalService');
const { assertCanAccessApprovals } = require('../../utils/commercial/dealEnginePermissions');

// R2/R12: Approvals is Hidden to Procurement (A12 lists Overview/BOQ/Materials/Suppliers for
// procurement, never Approvals). WHO may sign a given stage was already correctly enforced inside
// approvalService.js#setStageStatus (against req.commercialRole) before this change - that
// stage-by-stage role check is untouched; this only adds the "can this role see Approvals at all"
// gate neither function had.
exports.setStageStatus = asyncHandler(async (req, res) => {
  assertCanAccessApprovals(req.commercialRoles);
  const { status, note } = req.body;
  const revision = await approvalService.setStageStatus(req.params.id, req.params.stage.toUpperCase(), status, {
    userId: req.user._id, userRole: req.commercialRole, note, actor: req.user,
  });
  res.status(200).json(apiResponse('Approval stage updated successfully', true, revision));
});

exports.getApprovalLog = asyncHandler(async (req, res) => {
  assertCanAccessApprovals(req.commercialRoles);
  const log = await approvalService.getApprovalLog(req.params.id);
  res.status(200).json(apiResponse('Approval log retrieved successfully', true, log));
});
