const asyncHandler = require('express-async-handler');
const apiResponse = require('../../utils/apiResponse');
const adSpendService = require('../../services/crm/adSpendService');

exports.setAdSpend = asyncHandler(async (req, res) => {
  const { source, year, month, amountEgp } = req.body;
  const spend = await adSpendService.setAdSpend(source, year, month, amountEgp, { userId: req.user._id });
  res.status(200).json(apiResponse('Ad spend saved successfully', true, spend));
});

exports.listAdSpend = asyncHandler(async (req, res) => {
  const { year, month } = req.query;
  const rows = await adSpendService.listAdSpend(parseInt(year, 10), parseInt(month, 10));
  res.status(200).json(apiResponse('Ad spend retrieved successfully', true, rows));
});
