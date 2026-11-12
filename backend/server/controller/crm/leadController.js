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
const { valuePipeline } = require('../../services/crm/pipelineValuation');
const { hoursToFirstReply, SLA_WORKING_HOURS, leadOriginAt } = require('../../services/crm/firstReplyService');
const exportToCsv = require('../../utils/exportToCsv');
const { buildLeadExportRows, HEADERS: EXPORT_HEADERS } = require('../../services/crm/leadExportService');

// GET /leads - filterable list (stage/owner/segment/q), reusing the shared pagination/sort
// convention (handlersFactory.getAll + ApiFeatures) every other list endpoint in this codebase uses.
//
// Archived leads (acceptance report finding 7) are excluded by default - a soft-deleted test
// record must behave like it's gone for everyone's everyday view, not just visually hidden. Only
// the MD can even ask to see them (`includeArchived=1`), and only the MD has the archive/restore
// actions below that would ever put one there in the first place.
const listLeads = factory.getAll(Lead, 'CrmLead');
exports.getLeads = (req, res, next) => {
  const filter = {};
  const { stage, owner, segment, q, includeArchived } = req.query;
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
  if (!(includeArchived && req.crmRole === 'md')) filter.archived = { $ne: true };
  ['stage', 'owner', 'segment', 'q', 'includeArchived'].forEach(k => delete req.query[k]);
  req.filterObject = filter;
  return listLeads(req, res, next);
};

// GET /leads/pipeline - one lightweight aggregation for the Kanban board: every open/won/lost
// stage's lead count and total pipeline value, computed at read time (never a persisted,
// driftable summary) - same "pure read-time aggregation" approach this codebase already uses for
// the Cash Flow Forecast (services/cashflow/cashFlowForecastService.js). Archived leads never
// count toward the pipeline, for the same reason getLeads excludes them by default.
exports.getPipelineSummary = asyncHandler(async (req, res) => {
  const rows = await Lead.aggregate([
    { $match: { archived: { $ne: true } } },
    { $group: { _id: '$stage', count: { $sum: 1 }, valueEgp: { $sum: { $ifNull: ['$valueEgp', 0] } } } },
  ]);
  // weightedValueEgp (acceptance report finding 6) - each open stage's value discounted by its
  // probability of actually closing; Won/Lost always contribute 0 (Won is already-realized
  // revenue, not a forecast). Change Request 2, item 4: the SAME valuation the Dashboard uses
  // (services/crm/pipelineValuation.js), and every row now carries the `probability` it was
  // weighted with so the board can print it. Still an array of every stage, for backward
  // compatibility with existing consumers.
  const { stages } = valuePipeline(rows, { includeClosedStages: true });
  const summary = stages.map(({ stage, count, valueEgp, probability, weightedValueEgp }) => ({ stage, count, valueEgp, probability, weightedValueEgp }));
  res.status(200).json(apiResponse('Pipeline summary retrieved successfully', true, summary));
});

exports.getLeadById = asyncHandler(async (req, res, next) => {
  const lead = await Lead.findById(req.params.id);
  if (!lead) return next(new ApiError('Lead not found.', 404));
  // Direct-URL protection (not just "hidden from the list") - an archived lead is as good as gone
  // for anyone but the MD, who alone can also restore it.
  if (lead.archived && req.crmRole !== 'md') return next(new ApiError('Lead not found.', 404));
  const [activities, stageHistory] = await Promise.all([
    Activity.find({ lead: lead._id }).sort({ createdAt: 1 }),
    StageHistory.find({ lead: lead._id }).sort({ createdAt: 1 }),
  ]);
  // Change Request 2, item 3: the lead's own first-reply figures, computed by the same service
  // the Dashboard/Performance metrics use (working hours from the ORIGINAL submission time).
  const hours = hoursToFirstReply(lead);
  const firstReply = {
    originAt: leadOriginAt(lead),
    at: lead.firstReplyAt,
    via: lead.firstReplyVia || null,
    workingHours: hours == null ? null : Math.round(hours * 10) / 10,
    withinSla: hours == null ? null : hours <= SLA_WORKING_HOURS,
    slaWorkingHours: SLA_WORKING_HOURS,
  };
  res.status(200).json(apiResponse('Lead retrieved successfully', true, { lead, activities, stageHistory, firstReply }));
});

exports.createLead = asyncHandler(async (req, res) => {
  const { lead, created } = await leadService.intakeLead(req.body, { userId: req.user._id });
  res.status(created ? 201 : 200).json(apiResponse(created ? 'Lead created successfully' : 'A lead for this phone number already exists - merged.', true, lead));
});

exports.changeStage = asyncHandler(async (req, res) => {
  const lead = await leadService.changeStage(req.params.id, req.body, { userId: req.user._id, role: req.crmRole });
  res.status(200).json(apiResponse('Lead stage updated successfully', true, lead));
});

// PATCH /leads/:id - CRM Changes Required, item 1 (set the governorate so a failed Deal Engine
// sync can be retried). Technical cannot edit customer details.
exports.updateLeadDetails = asyncHandler(async (req, res) => {
  const lead = await leadService.updateLeadDetails(req.params.id, req.body, { userId: req.user._id });
  res.status(200).json(apiResponse('Lead updated successfully', true, lead));
});

exports.reassignLead = asyncHandler(async (req, res) => {
  const lead = await leadService.reassignLead(req.params.id, req.body.owner || null, { userId: req.user._id });
  res.status(200).json(apiResponse('Lead reassigned successfully', true, lead));
});

// PATCH /leads/:id/archive and /leads/:id/restore - MD only (requireCrmRole('md') on the route),
// acceptance report finding 7. Soft-delete only - see leadService.js#setLeadArchived.
exports.archiveLead = asyncHandler(async (req, res) => {
  const lead = await leadService.setLeadArchived(req.params.id, true, { userId: req.user._id, reason: req.body.reason });
  res.status(200).json(apiResponse('Lead archived successfully', true, lead));
});

exports.restoreLead = asyncHandler(async (req, res) => {
  const lead = await leadService.setLeadArchived(req.params.id, false, { userId: req.user._id });
  res.status(200).json(apiResponse('Lead restored successfully', true, lead));
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

// ---------------------------------------------------------------- CRM -> Commercial handoff (QA B5)

/** POST /crm/leads/:id/commercial-sync - re-runs the Commercial sync for the lead's current stage (retry after a failure). */
exports.retryCommercialSync = asyncHandler(async (req, res) => {
  // eslint-disable-next-line global-require
  const { retrySync } = require('../../services/crm/commercialHandoffService');
  const result = await retrySync(req.params.id, { userId: req.user._id });
  const lead = await Lead.findById(req.params.id);
  if (!result.ok) {
    return res.status(422).json(apiResponse(`Commercial sync failed: ${result.error}`, false, { lead, error: result.error }));
  }
  res.status(200).json(apiResponse(result.skipped ? 'Nothing to send to Commercial for this lead.' : 'Synchronized with Commercial.', true, { lead, identifiers: result.identifiers || null }));
});

/** GET /crm/leads/:id/commercial-sync - the append-only sync history for this lead. */
exports.getCommercialSyncLog = asyncHandler(async (req, res) => {
  // eslint-disable-next-line global-require
  const CommercialSyncEvent = require('../../models/commercial/commercialSyncEventModel');
  const events = await CommercialSyncEvent.find({ lead: req.params.id }).sort({ createdAt: -1 }).limit(50).populate({ path: 'actor', select: 'name' }).lean();
  res.status(200).json(apiResponse('Commercial sync history', true, events));
});
