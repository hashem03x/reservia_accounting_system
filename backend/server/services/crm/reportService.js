'use strict';
const mongoose = require('mongoose');
const Lead = require('../../models/crm/leadModel');
const StageHistory = require('../../models/crm/stageHistoryModel');
const CrmTarget = require('../../models/crm/targetModel');
const CrmAdSpend = require('../../models/crm/adSpendModel');
const { STAGE_WEIGHTS, SEGMENTS } = require('../../utils/crm/constants');
const { workingHoursBetween } = require('../../utils/crm/workingHours');

// Reservia CRM - the main Dashboard (acceptance report section 4). Every figure here is computed
// at read time from real Lead/StageHistory/CrmTarget/CrmAdSpend documents - nothing is hardcoded,
// mocked, or precomputed/cached in a way that could drift from the Leads list. "With the three
// test leads removed and ten seeded leads loaded, every figure matches a manual count from the
// Leads list" (the report's own acceptance line) is the standard every function here is held to.

const OPEN_STAGES = ['new', 'contacted', 'qualified', 'site_survey', 'proposal_sent', 'negotiation'];

/** [start, end) UTC bounds for a calendar month - `month` is 1-12, matching CrmTarget's own field. */
function monthBounds(year, month) {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  return { start, end };
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function average(values) {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function leadMatch({ start, end, ownerId }) {
  const match = { createdAt: { $gte: start, $lt: end }, archived: { $ne: true } };
  if (ownerId) match.owner = new mongoose.Types.ObjectId(ownerId);
  return match;
}

/**
 * Block 1: Targets. "Enquiries"/qualified/surveys/proposals/signed are each the count of DISTINCT
 * leads that reached at least that stage during the period - enquiries from Lead.createdAt,
 * everything else from the StageHistory event that actually moved a lead INTO that stage (never
 * "currently sitting in" it, which would undercount leads that passed through and moved on).
 * Targets come from CrmTarget - an owner/month with none set reports `target: null` for every
 * field, never a fabricated number (acceptance report: real MD-entered targets only).
 */
async function getTargetsBlock({ year, month, ownerId }) {
  const { start, end } = monthBounds(year, month);
  const leadFilter = leadMatch({ start, end, ownerId });

  const stageReached = async stage => {
    const match = { to: stage, createdAt: { $gte: start, $lt: end } };
    if (!ownerId) {
      return (await StageHistory.distinct('lead', match)).length;
    }
    const rows = await StageHistory.aggregate([
      { $match: match },
      { $lookup: { from: 'crmleads', localField: 'lead', foreignField: '_id', as: 'leadDoc' } },
      { $unwind: '$leadDoc' },
      { $match: { 'leadDoc.owner': new mongoose.Types.ObjectId(ownerId) } },
      { $group: { _id: '$lead' } },
    ]);
    return rows.length;
  };

  const [actualEnquiries, actualQualified, actualSurveys, actualProposals, actualSigned] = await Promise.all([
    Lead.countDocuments(leadFilter),
    stageReached('qualified'),
    stageReached('site_survey'),
    stageReached('proposal_sent'),
    stageReached('won'),
  ]);

  const targetFilter = { year, month };
  if (ownerId) targetFilter.owner = ownerId;
  const targets = await CrmTarget.find(targetFilter).lean();
  const sumTarget = field => {
    const withValue = targets.filter(t => t[field] != null);
    return withValue.length === 0 ? null : withValue.reduce((sum, t) => sum + t[field], 0);
  };

  return {
    enquiries: { actual: actualEnquiries, target: sumTarget('targetEnquiries') },
    qualified: { actual: actualQualified, target: sumTarget('targetQualified') },
    surveys: { actual: actualSurveys, target: sumTarget('targetSurveys') },
    proposals: { actual: actualProposals, target: sumTarget('targetProposals') },
    signed: { actual: actualSigned, target: sumTarget('targetSigned') },
    valueEgp: { target: sumTarget('targetValueEgp') },
  };
}

/**
 * Block 2: Pipeline by stage - the SAME computation GET /crm/leads/pipeline uses
 * (controller/crm/leadController.js#getPipelineSummary), factored out here so the dashboard can
 * never report a different weighted-pipeline figure than the Pipeline board itself. Owner-filtered
 * when a specific owner is selected; always every stage (count/EGP/weighted), even stages with no
 * leads, since every open stage is meaningful even when currently empty.
 */
async function getPipelineBlock({ ownerId }) {
  const match = { archived: { $ne: true } };
  if (ownerId) match.owner = new mongoose.Types.ObjectId(ownerId);
  const rows = await Lead.aggregate([{ $match: match }, { $group: { _id: '$stage', count: { $sum: 1 }, valueEgp: { $sum: { $ifNull: ['$valueEgp', 0] } } } }]);
  const byStage = Object.fromEntries(rows.map(r => [r._id, { count: r.count, valueEgp: r.valueEgp }]));
  const stages = OPEN_STAGES.map(stage => {
    const valueEgp = byStage[stage]?.valueEgp || 0;
    return { stage, count: byStage[stage]?.count || 0, valueEgp, weightedValueEgp: Math.round(valueEgp * (STAGE_WEIGHTS[stage] ?? 0)) };
  });
  return { stages, totalWeightedValueEgp: stages.reduce((sum, s) => sum + s.weightedValueEgp, 0) };
}

const SLA_HOURS = 8;

/** Block 3: Speed - leads past the 8-working-hour first-reply SLA, leads with no follow-up date, average hours to first reply. */
async function getSpeedBlock({ year, month, ownerId }) {
  const { start, end } = monthBounds(year, month);
  const filter = leadMatch({ start, end, ownerId });
  const now = new Date();

  const [pastSlaCount, noFollowUpCount, repliedLeads] = await Promise.all([
    Lead.countDocuments({ ...filter, stage: { $in: OPEN_STAGES }, firstReplyAt: null, replyDueAt: { $lt: now } }),
    Lead.countDocuments({ ...filter, stage: { $in: OPEN_STAGES }, followUpAt: null }),
    Lead.find({ ...filter, firstReplyAt: { $ne: null } })
      .select('createdAt firstReplyAt')
      .lean(),
  ]);

  // Working hours, not raw wall-clock hours - a reply that merely spans a Fri/Sat weekend must
  // never be reported as if the team took ~65 hours to respond (see utils/crm/workingHours.js).
  const hours = repliedLeads.map(l => workingHoursBetween(l.createdAt, l.firstReplyAt));
  const avgHoursToFirstReply = average(hours);
  const withinSla = hours.length === 0 ? null : (hours.filter(h => h <= SLA_HOURS).length / hours.length) * 100;

  return {
    leadsPastSlaLimit: pastSlaCount,
    leadsWithNoFollowUpDate: noFollowUpCount,
    avgHoursToFirstReply: avgHoursToFirstReply == null ? null : Math.round(avgHoursToFirstReply * 10) / 10,
    pctWithinSla: withinSla == null ? null : Math.round(withinSla * 10) / 10,
  };
}

const COST_PER_QUALIFIED_LEAD_LIMIT_EGP = 3500;

/**
 * Block 4: Source quality - leads/qualified/signed by source, cost per qualified lead against the
 * real monthly spend entered for that source (CrmAdSpend) - `costPerQualifiedLead: null` when no
 * spend was entered or there were zero qualified leads, never a fabricated/zero cost.
 */
async function getSourceQualityBlock({ year, month, ownerId }) {
  const { start, end } = monthBounds(year, month);
  const filter = leadMatch({ start, end, ownerId });

  const [bySource, wonRows, spendRows] = await Promise.all([
    Lead.aggregate([{ $match: filter }, { $group: { _id: '$source', leads: { $sum: 1 } } }]),
    StageHistory.aggregate([
      { $match: { to: 'won', createdAt: { $gte: start, $lt: end } } },
      { $lookup: { from: 'crmleads', localField: 'lead', foreignField: '_id', as: 'leadDoc' } },
      { $unwind: '$leadDoc' },
      ...(ownerId ? [{ $match: { 'leadDoc.owner': new mongoose.Types.ObjectId(ownerId) } }] : []),
      { $group: { _id: '$leadDoc.source', signed: { $sum: 1 } } },
    ]),
    CrmAdSpend.find({ year, month }).lean(),
  ]);

  // "Qualified" per source, same reached-stage definition as the Targets block.
  const qualifiedRows = await StageHistory.aggregate([
    { $match: { to: 'qualified', createdAt: { $gte: start, $lt: end } } },
    { $lookup: { from: 'crmleads', localField: 'lead', foreignField: '_id', as: 'leadDoc' } },
    { $unwind: '$leadDoc' },
    ...(ownerId ? [{ $match: { 'leadDoc.owner': new mongoose.Types.ObjectId(ownerId) } }] : []),
    { $group: { _id: '$leadDoc.source', qualified: { $sum: 1 } } },
  ]);

  const qualifiedBySource = Object.fromEntries(qualifiedRows.map(r => [r._id, r.qualified]));
  const signedBySource = Object.fromEntries(wonRows.map(r => [r._id, r.signed]));
  const spendBySource = Object.fromEntries(spendRows.map(r => [r.source, r.amountEgp]));

  const sources = bySource.map(r => {
    const source = r._id || 'Other';
    const qualified = qualifiedBySource[source] || 0;
    const spend = spendBySource[source];
    const costPerQualifiedLead = spend == null || qualified === 0 ? null : Math.round((spend / qualified) * 100) / 100;
    return {
      source,
      leads: r.leads,
      qualified,
      signed: signedBySource[source] || 0,
      monthlySpendEgp: spend ?? null,
      costPerQualifiedLead,
      overCostLimit: costPerQualifiedLead != null && costPerQualifiedLead > COST_PER_QUALIFIED_LEAD_LIMIT_EGP,
    };
  });

  return { sources, costPerQualifiedLeadLimitEgp: COST_PER_QUALIFIED_LEAD_LIMIT_EGP };
}

/** Block 5: Won and lost - win rate by segment, median days to close, lost reasons ranked. All 7 segments always listed, even at zero. */
async function getWonLostBlock({ year, month, ownerId }) {
  const { start, end } = monthBounds(year, month);
  const ownerStage = stage => {
    const match = { to: stage, createdAt: { $gte: start, $lt: end } };
    return StageHistory.aggregate([
      { $match: match },
      { $lookup: { from: 'crmleads', localField: 'lead', foreignField: '_id', as: 'leadDoc' } },
      { $unwind: '$leadDoc' },
      ...(ownerId ? [{ $match: { 'leadDoc.owner': new mongoose.Types.ObjectId(ownerId) } }] : []),
    ]);
  };

  const [wonEvents, lostEvents] = await Promise.all([ownerStage('won'), ownerStage('lost')]);

  const bySegment = {};
  for (const seg of SEGMENTS.filter(s => s !== 'unknown')) bySegment[seg] = { won: 0, lost: 0 };
  for (const e of wonEvents) {
    const seg = e.leadDoc.segment || 'other';
    bySegment[seg] = bySegment[seg] || { won: 0, lost: 0 };
    bySegment[seg].won += 1;
  }
  for (const e of lostEvents) {
    const seg = e.leadDoc.segment || 'other';
    bySegment[seg] = bySegment[seg] || { won: 0, lost: 0 };
    bySegment[seg].lost += 1;
  }
  const winRateBySegment = Object.entries(bySegment).map(([segment, { won, lost }]) => ({
    segment,
    won,
    lost,
    winRatePct: won + lost === 0 ? null : Math.round((won / (won + lost)) * 1000) / 10,
  }));

  const daysToClose = wonEvents.map(e => (e.createdAt - e.leadDoc.createdAt) / 86400000);
  const medianDaysToClose = median(daysToClose);

  const lostReasonCounts = {};
  for (const e of lostEvents) {
    const reason = e.lostReason || 'Other';
    lostReasonCounts[reason] = (lostReasonCounts[reason] || 0) + 1;
  }
  const lostReasonsRanked = Object.entries(lostReasonCounts)
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);

  return {
    winRateBySegment,
    medianDaysToClose: medianDaysToClose == null ? null : Math.round(medianDaysToClose * 10) / 10,
    lostReasonsRanked,
    wonCount: wonEvents.length,
    lostCount: lostEvents.length,
  };
}

/** Block 6: This week - a fixed trailing 7-day window (not the month filter), owner-filtered. */
async function getThisWeekBlock({ ownerId }) {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 86400000);
  const ownerFilter = ownerId ? { owner: new mongoose.Types.ObjectId(ownerId) } : {};

  const [newLeadsCount, movesCount, oldestUnanswered] = await Promise.all([
    Lead.countDocuments({ ...ownerFilter, createdAt: { $gte: weekAgo }, archived: { $ne: true } }),
    StageHistory.aggregate([
      { $match: { createdAt: { $gte: weekAgo } } },
      { $lookup: { from: 'crmleads', localField: 'lead', foreignField: '_id', as: 'leadDoc' } },
      { $unwind: '$leadDoc' },
      ...(ownerId ? [{ $match: { 'leadDoc.owner': new mongoose.Types.ObjectId(ownerId) } }] : []),
      { $count: 'total' },
    ]),
    Lead.find({ ...ownerFilter, stage: { $in: OPEN_STAGES }, firstReplyAt: null, archived: { $ne: true } })
      .sort({ createdAt: 1 })
      .limit(5)
      .select('refCode name phoneE164 stage createdAt')
      .lean(),
  ]);

  return {
    newLeads: newLeadsCount,
    moves: movesCount[0]?.total || 0,
    oldestUnanswered,
  };
}

/**
 * The full Dashboard payload. `ownerId` null/undefined means "all owners" (MD/admin view); a
 * sales/technical caller should always pass their own id (enforced by the controller, never
 * trusted from the client) - see controller/crm/reportController.js.
 */
async function getDashboard({ year, month, ownerId }) {
  const [targets, pipeline, speed, sourceQuality, wonLost, thisWeek] = await Promise.all([
    getTargetsBlock({ year, month, ownerId }),
    getPipelineBlock({ ownerId }),
    getSpeedBlock({ year, month, ownerId }),
    getSourceQualityBlock({ year, month, ownerId }),
    getWonLostBlock({ year, month, ownerId }),
    getThisWeekBlock({ ownerId }),
  ]);
  return { year, month, owner: ownerId || null, targets, pipeline, speed, sourceQuality, wonLost, thisWeek };
}

module.exports = {
  getDashboard,
  getTargetsBlock,
  getPipelineBlock,
  getSpeedBlock,
  getSourceQualityBlock,
  getWonLostBlock,
  getThisWeekBlock,
  monthBounds,
  median,
  average,
};
