const asyncHandler = require('express-async-handler');
const ApiError = require('../../utils/apiError');
const apiResponse = require('../../utils/apiResponse');
const reportService = require('../../services/crm/reportService');
const performanceReportService = require('../../services/crm/performanceReportService');

/**
 * Resolves the effective owner filter for a report request. MD/admin may view any owner (or
 * 'all', meaning no filter); a sales/technical caller is ALWAYS scoped to their own leads,
 * regardless of what `owner` the client sent - "sales user sees own leads + team totals" (section
 * 4), and never another individual's breakdown. This mirrors every other CRM role check in this
 * codebase: the server decides, the client's own request is never trusted for this.
 */
function resolveOwnerId(req) {
  const isManager = req.crmRole === 'md' || req.crmRole === 'admin';
  if (!isManager) return String(req.user._id);
  const requested = req.query.owner;
  if (!requested || requested === 'all') return null;
  return requested;
}

function resolveYearMonth(req) {
  const month = req.query.month; // "YYYY-MM"
  if (!/^\d{4}-\d{2}$/.test(String(month || ''))) {
    throw new ApiError('month is required in YYYY-MM format.', 400);
  }
  const [year, m] = month.split('-').map(Number);
  if (m < 1 || m > 12) throw new ApiError('Invalid month.', 400);
  return { year, month: m };
}

exports.getDashboard = asyncHandler(async (req, res) => {
  const { year, month } = resolveYearMonth(req);
  const ownerId = resolveOwnerId(req);
  const data = await reportService.getDashboard({ year, month, ownerId });
  res.status(200).json(apiResponse('Dashboard retrieved successfully', true, data));
});

exports.getPerformance = asyncHandler(async (req, res) => {
  const { year, month } = resolveYearMonth(req);
  const ownerId = resolveOwnerId(req);
  const segment = req.query.segment || null;
  const data = await performanceReportService.getPerformance({ year, month, ownerId, segment });
  res.status(200).json(apiResponse('Performance report retrieved successfully', true, data));
});
