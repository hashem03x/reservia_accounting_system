const asyncHandler = require('express-async-handler');
const apiResponse = require('../../utils/apiResponse');
const targetService = require('../../services/crm/targetService');

exports.setTarget = asyncHandler(async (req, res) => {
  const { segment, year, month, targetValueEgp, targetDealCount, targetEnquiries, targetQualified, targetSurveys, targetProposals, targetSigned } = req.body;
  const target = await targetService.setTarget(
    segment,
    year,
    month,
    { targetValueEgp, targetDealCount, targetEnquiries, targetQualified, targetSurveys, targetProposals, targetSigned },
    { userId: req.user._id }
  );
  res.status(200).json(apiResponse('Target saved successfully', true, target));
});

exports.listTargets = asyncHandler(async (req, res) => {
  const { year, month, segment } = req.query;
  const targets = await targetService.listTargets(parseInt(year, 10), parseInt(month, 10), { segment });
  res.status(200).json(apiResponse('Targets retrieved successfully', true, targets));
});
