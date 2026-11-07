const asyncHandler = require('express-async-handler');
const apiResponse = require('../../utils/apiResponse');
const approvalService = require('../../services/commercial/approvalService');

exports.setStageStatus = asyncHandler(async (req, res) => {
  const { status, note } = req.body;
  const revision = await approvalService.setStageStatus(req.params.id, req.params.stage.toUpperCase(), status, {
    userId: req.user._id, userRole: req.commercialRole, note,
  });
  res.status(200).json(apiResponse('Approval stage updated successfully', true, revision));
});

exports.getApprovalLog = asyncHandler(async (req, res) => {
  const log = await approvalService.getApprovalLog(req.params.id);
  res.status(200).json(apiResponse('Approval log retrieved successfully', true, log));
});
