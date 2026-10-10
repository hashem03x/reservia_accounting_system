const asyncHandler = require('express-async-handler');
const apiResponse = require('../../utils/apiResponse');
const { listPeriods, closePeriod, reopenPeriod } = require('../../services/accounting/accountingPeriodService');
const { logAccountingEvent } = require('../../utils/accountingLogger');

// Accounting periods (routes/accounting/accountingPeriodRoute.js): anyone signed in may read which
// months are closed; only administrators close or reopen one.

exports.getAccountingPeriods = asyncHandler(async (req, res) => {
  res.status(200).json(apiResponse('Accounting periods retrieved successfully', true, await listPeriods()));
});

exports.closeAccountingPeriod = asyncHandler(async (req, res) => {
  const period = await closePeriod(req.params.period, req.user._id, req.body?.note);
  logAccountingEvent('ACCOUNTING_PERIOD_CLOSED', { period: period.period, userId: req.user._id, requestId: req.id });
  res.status(200).json(apiResponse(`Accounting period ${period.period} closed`, true, period));
});

exports.reopenAccountingPeriod = asyncHandler(async (req, res) => {
  const period = await reopenPeriod(req.params.period, req.user._id, req.body?.note);
  logAccountingEvent('ACCOUNTING_PERIOD_REOPENED', { period: period.period, userId: req.user._id, requestId: req.id });
  res.status(200).json(apiResponse(`Accounting period ${period.period} reopened`, true, period));
});
