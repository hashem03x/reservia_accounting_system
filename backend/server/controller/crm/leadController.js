const crypto = require('crypto');
const mongoose = require('mongoose');
const asyncHandler = require('express-async-handler');
const Lead = require('../../models/crm/leadModel');
const Activity = require('../../models/crm/activityModel');
const StageHistory = require('../../models/crm/stageHistoryModel');
const factory = require('../handlersFactory');
const ApiError = require('../../utils/apiError');
const apiResponse = require('../../utils/apiResponse');
const { STAGES } = require('../../utils/crm/stageRules');
const leadService = require('../../services/crm/leadService');
const exportToCsv = require('../../utils/exportToCsv');
const { buildLeadExportRows, HEADERS: EXPORT_HEADERS } = require('../../services/crm/leadExportService');

// GET /leads - filterable list (stage/owner/segment/q), reusing the shared pagination/sort
// convention (handlersFactory.getAll + ApiFeatures) every other list endpoint in this codebase uses.
const listLeads = factory.getAll(Lead, 'CrmLead');
exports.getLeads = (req, res, next) => {
  const filter = {};
  const { stage, owner, segment, q } = req.query;
  if (stage) {
    if (!STAGES.includes(stage)) return next(new ApiError('Invalid stage filter.', 400));
    filter.stage = stage;
  }
  if (owner) {
    if (!mongoose.Types.ObjectId.isValid(String(owner))) return next(new ApiError('Invalid owner id.', 400));
    filter.owner = owner;
  }
  if (segment) filter.segment = segment;
  if (q) filter.$text = { $search: q };
  ['stage', 'owner', 'segment', 'q'].forEach(k => delete req.query[k]);
  req.filterObject = filter;
  return listLeads(req, res, next);
};

// GET /leads/pipeline - one lightweight aggregation for the Kanban board: every open/won/lost
// stage's lead count and total pipeline value, computed at read time (never a persisted,
// driftable summary) - same "pure read-time aggregation" approach this codebase already uses for
// the Cash Flow Forecast (services/cashflow/cashFlowForecastService.js).
exports.getPipelineSummary = asyncHandler(async (req, res) => {
  const rows = await Lead.aggregate([
    { $group: { _id: '$stage', count: { $sum: 1 }, valueEgp: { $sum: { $ifNull: ['$valueEgp', 0] } } } },
  ]);
  const byStage = Object.fromEntries(rows.map(r => [r._id, { count: r.count, valueEgp: r.valueEgp }]));
  const summary = STAGES.map(stage => ({ stage, count: byStage[stage]?.count || 0, valueEgp: byStage[stage]?.valueEgp || 0 }));
  res.status(200).json(apiResponse('Pipeline summary retrieved successfully', true, summary));
});

exports.getLeadById = asyncHandler(async (req, res, next) => {
  const lead = await Lead.findById(req.params.id);
  if (!lead) return next(new ApiError('Lead not found.', 404));
  const [activities, stageHistory] = await Promise.all([
    Activity.find({ lead: lead._id }).sort({ createdAt: 1 }),
    StageHistory.find({ lead: lead._id }).sort({ createdAt: 1 }),
  ]);
  res.status(200).json(apiResponse('Lead retrieved successfully', true, { lead, activities, stageHistory }));
});

exports.createLead = asyncHandler(async (req, res) => {
  const { lead, created } = await leadService.intakeLead(req.body, { userId: req.user._id });
  res.status(created ? 201 : 200).json(apiResponse(created ? 'Lead created successfully' : 'A lead for this phone number already exists - merged.', true, lead));
});

exports.changeStage = asyncHandler(async (req, res) => {
  const lead = await leadService.changeStage(req.params.id, req.body, { userId: req.user._id, role: req.crmRole });
  res.status(200).json(apiResponse('Lead stage updated successfully', true, lead));
});

exports.reassignLead = asyncHandler(async (req, res) => {
  const lead = await leadService.reassignLead(req.params.id, req.body.owner || null, { userId: req.user._id });
  res.status(200).json(apiResponse('Lead reassigned successfully', true, lead));
});

exports.recordActivity = asyncHandler(async (req, res) => {
  const activity = await leadService.recordActivity(req.params.id, req.body, { userId: req.user._id });
  res.status(201).json(apiResponse('Activity recorded successfully', true, activity));
});

// GET /leads/export - the Marketing Dashboard's weekly CSV (services/crm/leadExportService.js),
// on-demand for a logged-in CRM user (gated by requireCrmAccess on this router).
exports.exportLeads = asyncHandler(async (req, res) => {
  const rows = await buildLeadExportRows();
  await exportToCsv(res, `reservia-crm-leads-${new Date().toISOString().slice(0, 10)}.csv`, EXPORT_HEADERS, rows);
});

// GET /leads/export-cron - the SAME export for an external scheduler (Vercel Cron), authenticated
// with `Authorization: Bearer <CRON_SECRET>` instead of a user session - mirrors
// backup.controller.js#cronBackup's exact check (length-matched, constant-time compare; disabled
// entirely unless CRON_SECRET is at least 16 characters).
exports.exportLeadsCron = asyncHandler(async (req, res, next) => {
  const secret = process.env.CRON_SECRET || '';
  const given = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const ok = secret.length >= 16 && given.length === secret.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(secret));
  if (!ok) return next(new ApiError('Not allowed.', 401));
  const rows = await buildLeadExportRows();
  await exportToCsv(res, `reservia-crm-leads-${new Date().toISOString().slice(0, 10)}.csv`, EXPORT_HEADERS, rows);
});
