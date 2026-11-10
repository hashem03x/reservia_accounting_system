const asyncHandler = require('express-async-handler');
const apiResponse = require('../../utils/apiResponse');
const adSpendService = require('../../services/crm/adSpendService');

exports.setAdSpend = asyncHandler(async (req, res) => {
  const { channel, segment, year, month, amountEgp, actualAmountEgp } = req.body;
  const spend = await adSpendService.setAdSpend(channel, year, month, amountEgp, {
    segment: segment || null,
    userId: req.user._id,
    actualAmountEgp: actualAmountEgp === undefined ? undefined : actualAmountEgp === null || actualAmountEgp === '' ? null : Number(actualAmountEgp),
  });
  res.status(200).json(apiResponse('Ad spend saved successfully', true, spend));
});

exports.listAdSpend = asyncHandler(async (req, res) => {
  const { year, month } = req.query;
  const rows = await adSpendService.listAdSpend(parseInt(year, 10), parseInt(month, 10));
  res.status(200).json(apiResponse('Ad spend retrieved successfully', true, rows));
});
