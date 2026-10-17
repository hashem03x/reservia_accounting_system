const asyncHandler = require('express-async-handler');
const ApiError = require('../../utils/apiError');
const apiResponse = require('../../utils/apiResponse');
const { getConsolidatedForecast, getProjectForecast } = require('../../services/cashflow/cashFlowForecastService');

// Projected Cash Flow Forecasting - Phase 1. Both handlers are read-only: they only ever call
// into cashFlowForecastService.js, which itself only ever reads
// Project/SalesOrder/Requisition/PurchaseOrder/ChartOfAccount/JournalEntry - nothing here can post
// a journal entry or change any accounting balance.

const getConsolidated = asyncHandler(async (req, res) => {
  const data = await getConsolidatedForecast(req.query);
  res.status(200).json(apiResponse('Consolidated cash flow forecast retrieved successfully', true, data));
});

const getProject = asyncHandler(async (req, res, next) => {
  const data = await getProjectForecast(req.params.projectId, req.query);
  if (!data.project) return next(new ApiError('No project found with that id', 404));
  res.status(200).json(apiResponse('Project cash flow forecast retrieved successfully', true, data));
});

module.exports = { getConsolidated, getProject };
