const asyncHandler = require('express-async-handler');
const CommercialRevision = require('../../models/commercial/commercialRevisionModel');
const ApiError = require('../../utils/apiError');
const apiResponse = require('../../utils/apiResponse');
const revisionService = require('../../services/commercial/revisionService');

exports.getRevision = asyncHandler(async (req, res, next) => {
  const revision = await CommercialRevision.findById(req.params.id);
  if (!revision) return next(new ApiError('Revision not found.', 404));
  res.status(200).json(apiResponse('Revision retrieved successfully', true, revision));
});

/** Recomputes the CURRENT revision's engineering/BOQ/pricing from new inputs - resets any already-signed-off stage per the re-approval rule. */
exports.recomputeRevision = asyncHandler(async (req, res) => {
  const { engineeringInput, manualOverrides, pricingOverrides } = req.body;
  const revision = await revisionService.recomputeCurrentRevision(req.params.id, engineeringInput, { manualOverrides, pricingOverrides, userId: req.user._id });
  res.status(200).json(apiResponse('Revision recomputed successfully', true, revision));
});

/** Creates a brand-new revision (never edits a previous one) against the same project. */
exports.createRevisionForProject = asyncHandler(async (req, res) => {
  const { engineeringInput, manualOverrides, pricingOverrides } = req.body;
  const revision = await revisionService.createRevision(req.params.projectId, engineeringInput, { manualOverrides, pricingOverrides, userId: req.user._id });
  res.status(201).json(apiResponse('Revision created successfully', true, revision));
});
