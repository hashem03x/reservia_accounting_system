'use strict';
const mongoose = require('mongoose');
const Lead = require('../../models/crm/leadModel');
const StageHistory = require('../../models/crm/stageHistoryModel');
const CrmTarget = require('../../models/crm/targetModel');
const CrmAdSpend = require('../../models/crm/adSpendModel');
const { SEGMENTS } = require('../../utils/crm/constants');
const { cairoMonthBounds } = require('../../utils/crm/businessDate');
const { valuePipeline, stageProbabilities } = require('./pipelineValuation');
const { computeFirstReplyMetrics } = require('./firstReplyService');

// Reservia CRM - the main Dashboard (acceptance report section 4). Every figure here is computed
// at read time from real Lead/StageHistory/CrmTarget/CrmAdSpend documents - nothing is hardcoded,
// mocked, or precomputed/cached in a way that could drift from the Leads list. "With the three
// test leads removed and ten seeded leads loaded, every figure matches a manual count from the
// Leads list" (the report's own acceptance line) is the standard every function here is held to.
//
// Change Request 2 adjustments, applied uniformly to every block:
//   - Months are CAIRO calendar months (utils/crm/businessDate.js#cairoMonthBounds), not UTC.
//   - A lead belongs to the month it was ORIGINALLY submitted (Lead.submittedAt, falling back to
//     createdAt for legacy leads), so a CSV-imported lead is never moved into the import month.
//   - Archived leads are excluded from every count, not only from "enquiries".
//   - A funnel stage counts every lead that REACHED it - including a lead that skipped it on the
//     way to a later stage (legacy data from before strict progression, or an MD override) - so
//     "Qualified 0, Surveys 1" can no longer happen.

const OPEN_STAGES = ['new', 'contacted', 'qualified', 'site_survey', 'proposal_sent', 'negotiation'];
// Funnel order for the "reached at least this stage" counts. Lost is not a funnel step.
const FUNNEL_ORDER = ['new', 'contacted', 'qualified', 'site_survey', 'proposal_sent', 'negotiation', 'won'];

/** [start, end) of a Cairo calendar month - `month` is 1-12, matching CrmTarget's own field. */
function monthBounds(year, month) {
  return cairoMonthBounds(year, month);
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

const oid = id => new mongoose.Types.ObjectId(id);

/**
 * Mongo filter: the lead's ORIGIN time (submittedAt, else createdAt) is inside [start, end).
 * `prefix` targets a $lookup'd lead document (e.g. 'leadDoc').
 */
function originInRange(start, end, prefix = '') {
  const p = prefix ? `${prefix}.` : '';
  return {
    $or: [{ [`${p}submittedAt`]: { $gte: start, $lt: end } }, { [`${p}submittedAt`]: null, [`${p}createdAt`]: { $gte: start, $lt: end } }],
  };
}

function leadMatch({ start, end, ownerId, segment }) {
  const match = { ...originInRange(start, end), archived: { $ne: true } };
  if (ownerId) match.owner = oid(ownerId);
  if (segment) match.segment = segment;
  return match;
}

/**
 * Distinct (non-archived) leads that reached `stage` during [start, end) - the ONE definition of
 * "reached" every Dashboard/Performance funnel count uses.
 *   - direct: a StageHistory event moved the lead INTO `stage` within the period (unchanged rule);
 *   - implicit: the lead never entered `stage` at all but its FIRST move to a later funnel stage
 *     happened within the period (it skipped `stage`; it still passed that point of the funnel).
 * Returns [{ _id, segment, owner, source }].
 */
async function reachedStageLeads({ stage, start, end, ownerId = null, segment = null }) {
  const idx = FUNNEL_ORDER.indexOf(stage);
  const atOrBeyond = idx === -1 ? [stage] : FUNNEL_ORDER.slice(idx);
  const leadFilter = { 'leadDoc.archived': { $ne: true } };
  if (ownerId) leadFilter['leadDoc.owner'] = oid(ownerId);
  if (segment) leadFilter['leadDoc.segment'] = segment;

  const rows = await StageHistory.aggregate([
    { $match: { to: { $in: atOrBeyond }, createdAt: { $gte: start, $lt: end } } },
    { $lookup: { from: 'crmleads', localField: 'lead', foreignField: '_id', as: 'leadDoc' } },
    { $unwind: '$leadDoc' },
    { $match: leadFilter },
    {
      $group: {
        _id: '$lead',
        direct: { $max: { $cond: [{ $eq: ['$to', stage] }, 1, 0] } },
        segment: { $first: '$leadDoc.segment' },
        owner: { $first: '$leadDoc.owner' },
        source: { $first: '$leadDoc.source' },
      },
    },
  ]);
  const direct = rows.filter(r => r.direct === 1);
  const candidates = rows.filter(r => r.direct !== 1);
  if (candidates.length === 0) return direct;

  const firstReach = await StageHistory.aggregate([
    { $match: { lead: { $in: candidates.map(r => r._id) }, to: { $in: atOrBeyond } } },
    {
      $group: {
        _id: '$lead',
        firstAt: { $min: '$createdAt' },
        enteredStage: { $max: { $cond: [{ $eq: ['$to', stage] }, 1, 0] } },
      },
    },
  ]);
  const implicit = new Set(firstReach.filter(r => r.enteredStage === 0 && r.firstAt >= start && r.firstAt < end).map(r => String(r._id)));
  return [...direct, ...candidates.filter(r => implicit.has(String(r._id)))];
}

const countReached = async args => (await reachedStageLeads(args)).length;

/**
 * Block 1: Targets. Enquiries = leads originally submitted in the month; qualified/surveys/
 * proposals/signed = distinct leads that REACHED that stage in the month (reachedStageLeads).
 *
 * Targets come from CrmTarget, keyed by (segment, month) (Change Request 1, Feature 5A) - the
 * Dashboard itself has no segment filter, so it always reads the single company-wide `segment:
 * 'all'` record for the month, regardless of which owner's ACTUAL counts are shown alongside it.
 * A field with no target set reports `target: null`, never a fabricated number.
 */
async function getTargetsBlock({ year, month, ownerId }) {
  const { start, end } = monthBounds(year, month);
  const range = { start, end, ownerId };

  const [actualEnquiries, actualQualified, actualSurveys, actualProposals, actualSigned, target] = await Promise.all([
    Lead.countDocuments(leadMatch(range)),
    countReached({ stage: 'qualified', ...range }),
    countReached({ stage: 'site_survey', ...range }),
    countReached({ stage: 'proposal_sent', ...range }),
    countReached({ stage: 'won', ...range }),
    CrmTarget.findOne({ segment: 'all', year, month }).lean(),
  ]);
  const field = f => (target && target[f] != null ? target[f] : null);

  return {
    enquiries: { actual: actualEnquiries, target: field('targetEnquiries') },
    qualified: { actual: actualQualified, target: field('targetQualified') },
    surveys: { actual: actualSurveys, target: field('targetSurveys') },
    proposals: { actual: actualProposals, target: field('targetProposals') },
    signed: { actual: actualSigned, target: field('targetSigned') },
    valueEgp: { target: field('targetValueEgp') },
    targetSet: !!target,
  };
}

/**
 * Block 2: Pipeline by stage - the SAME computation GET /crm/leads/pipeline uses
 * (services/crm/pipelineValuation.js), so the Dashboard can never report a different figure than
 * the Pipeline board. A point-in-time snapshot of OPEN, non-archived leads (owner-filtered when an
 * owner is selected) - deliberately not month-filtered: an open deal's value is in the pipeline
 * today regardless of the month it arrived. Returns BOTH the full pipeline value and the weighted
 * value (Change Request 2, item 4), and every stage's probability.
 */
async function getPipelineBlock({ ownerId }) {
  const match = { archived: { $ne: true } };
  if (ownerId) match.owner = oid(ownerId);
  const rows = await Lead.aggregate([{ $match: match }, { $group: { _id: '$stage', count: { $sum: 1 }, valueEgp: { $sum: { $ifNull: ['$valueEgp', 0] } } } }]);
  const valuation = valuePipeline(rows);
  return {
    stages: valuation.stages.map(({ stage, count, valueEgp, probability, weightedValueEgp }) => ({ stage, count, valueEgp, probability, weightedValueEgp })),
    totalValueEgp: valuation.totalValueEgp,
    totalWeightedValueEgp: valuation.totalWeightedValueEgp,
    openLeadCount: valuation.openLeadCount,
    probabilities: stageProbabilities(),
    unconfiguredStages: valuation.unconfiguredStages,
  };
}

/**
 * Block 3: Speed - leads past the 8-working-hour first-reply SLA, leads with no follow-up date,
 * and the first-reply metrics (services/crm/firstReplyService.js#computeFirstReplyMetrics - the
 * SAME function the Performance tab uses).
 */
async function getSpeedBlock({ year, month, ownerId }) {
  const { start, end } = monthBounds(year, month);
  const filter = leadMatch({ start, end, ownerId });
  const now = new Date();

  const [pastSlaCount, noFollowUpCount, leads] = await Promise.all([
    Lead.countDocuments({ ...filter, stage: { $in: OPEN_STAGES }, firstReplyAt: null, replyDueAt: { $lt: now } }),
    Lead.countDocuments({ ...filter, stage: { $in: OPEN_STAGES }, followUpAt: null }),
    Lead.find(filter).select('createdAt submittedAt firstReplyAt replyDueAt').lean(),
  ]);
  const firstReply = computeFirstReplyMetrics(leads, { now });

  return {
    leadsPastSlaLimit: pastSlaCount,
    leadsWithNoFollowUpDate: noFollowUpCount,
    avgHoursToFirstReply: firstReply.avgHours,
    pctWithinSla: firstReply.pctWithinSla,
    firstReply,
  };
}

const COST_PER_QUALIFIED_LEAD_LIMIT_EGP = 3500;

/**
 * Spend for one line item: `amountEgp` is the PLANNED budget (what Change Request 1, section 5
 * gave), `actualAmountEgp` the real spend once the MD enters it. Cost-per-lead figures use the
 * actual figure when it exists and the planned one otherwise, and always say which (`basis`).
 */
function effectiveSpend(row) {
  return row.actualAmountEgp != null ? row.actualAmountEgp : row.amountEgp;
}

function summarizeSpend(rows) {
  const planned = rows.reduce((sum, r) => sum + (r.amountEgp || 0), 0);
  const withActual = rows.filter(r => r.actualAmountEgp != null);
  const actual = withActual.length ? withActual.reduce((sum, r) => sum + r.actualAmountEgp, 0) : null;
  let basis = null;
  if (rows.length) basis = withActual.length === 0 ? 'planned' : withActual.length === rows.length ? 'actual' : 'mixed';
  return { plannedSpendEgp: rows.length ? planned : null, actualSpendEgp: actual, effectiveSpendEgp: rows.length ? rows.reduce((s, r) => s + effectiveSpend(r), 0) : null, basis, lineCount: rows.length };
}

const safeDivide = (amount, count) => (amount == null || !count ? null : Math.round((amount / count) * 100) / 100);

/**
 * Block 4: Segment quality (Change Request 1, Feature 5C) + overall marketing cost (Change Request
 * 2, item 5) - leads/qualified/signed by SEGMENT, cost per qualified lead and cost per enquiry
 * against the month's ad spend for that segment (CrmAdSpend.segment, summed across every
 * channel/budget line tagged with it). A segment WITH spend but no leads yet is still listed (its
 * cost per lead is null - "no enquiries yet", never a misleading zero or infinity). A line with no
 * segment tag (e.g. "SEO", "Agency fees") is excluded from segment rows but included in `totals`.
 */
async function getSegmentQualityBlock({ year, month, ownerId }) {
  const { start, end } = monthBounds(year, month);
  const range = { start, end, ownerId };

  const [bySegment, signedLeads, qualifiedLeads, spendRows] = await Promise.all([
    Lead.aggregate([{ $match: leadMatch(range) }, { $group: { _id: '$segment', leads: { $sum: 1 } } }]),
    reachedStageLeads({ stage: 'won', ...range }),
    reachedStageLeads({ stage: 'qualified', ...range }),
    CrmAdSpend.find({ year, month }).lean(),
  ]);

  const tally = rows => rows.reduce((acc, r) => ({ ...acc, [r.segment || 'unknown']: (acc[r.segment || 'unknown'] || 0) + 1 }), {});
  const qualifiedBySegment = tally(qualifiedLeads);
  const signedBySegment = tally(signedLeads);
  const leadsBySegment = Object.fromEntries(bySegment.map(r => [r._id || 'unknown', r.leads]));
  const spendBySegment = {};
  for (const row of spendRows) {
    if (!row.segment) continue; // not attributable to one segment (SEO, agency fees, ...)
    spendBySegment[row.segment] = spendBySegment[row.segment] || [];
    spendBySegment[row.segment].push(row);
  }

  const segmentIds = [...new Set([...Object.keys(leadsBySegment), ...Object.keys(spendBySegment)])];
  const segments = segmentIds.map(segment => {
    const leads = leadsBySegment[segment] || 0;
    const qualified = qualifiedBySegment[segment] || 0;
    const spend = spendBySegment[segment] ? summarizeSpend(spendBySegment[segment]) : null;
    const costPerQualifiedLead = safeDivide(spend?.effectiveSpendEgp ?? null, qualified);
    return {
      segment,
      leads,
      qualified,
      signed: signedBySegment[segment] || 0,
      monthlySpendEgp: spend?.effectiveSpendEgp ?? null,
      plannedSpendEgp: spend?.plannedSpendEgp ?? null,
      actualSpendEgp: spend?.actualSpendEgp ?? null,
      spendBasis: spend?.basis ?? null,
      costPerQualifiedLead,
      costPerEnquiry: safeDivide(spend?.effectiveSpendEgp ?? null, leads),
      overCostLimit: costPerQualifiedLead != null && costPerQualifiedLead > COST_PER_QUALIFIED_LEAD_LIMIT_EGP,
    };
  });

  // Overall figures - every spend line for the month, every enquiry/qualified lead in scope.
  const totalSpend = summarizeSpend(spendRows);
  const enquiries = Object.values(leadsBySegment).reduce((s, n) => s + n, 0);
  const totals = {
    ...totalSpend,
    enquiries,
    qualified: qualifiedLeads.length,
    costPerEnquiry: safeDivide(totalSpend.effectiveSpendEgp, enquiries),
    costPerQualifiedLead: safeDivide(totalSpend.effectiveSpendEgp, qualifiedLeads.length),
  };

  return { segments, totals, costPerQualifiedLeadLimitEgp: COST_PER_QUALIFIED_LEAD_LIMIT_EGP };
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
      { $match: { 'leadDoc.archived': { $ne: true }, ...(ownerId ? { 'leadDoc.owner': oid(ownerId) } : {}) } },
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

  const daysToClose = wonEvents.map(e => (e.createdAt - (e.leadDoc.submittedAt || e.leadDoc.createdAt)) / 86400000);
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
  const ownerFilter = ownerId ? { owner: oid(ownerId) } : {};

  const [newLeadsCount, movesCount, oldestUnanswered] = await Promise.all([
    Lead.countDocuments({ ...ownerFilter, createdAt: { $gte: weekAgo }, archived: { $ne: true } }),
    StageHistory.aggregate([
      { $match: { createdAt: { $gte: weekAgo } } },
      { $lookup: { from: 'crmleads', localField: 'lead', foreignField: '_id', as: 'leadDoc' } },
      { $unwind: '$leadDoc' },
      { $match: { 'leadDoc.archived': { $ne: true }, ...(ownerId ? { 'leadDoc.owner': oid(ownerId) } : {}) } },
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
 * Change Request 1, Feature 3: org-wide reconciliation figures, shown beside a single-owner view
 * so a sales user's own numbers and the always-org-wide Pipeline board can be read side by side
 * (an unassigned web lead is in the org-wide figures, never silently missing). Aggregate-only -
 * nothing here lists or names another rep's individual leads.
 */
async function getTeamTotals({ year, month }) {
  const { start, end } = monthBounds(year, month);
  const range = { start, end, ownerId: null };
  const [enquiries, unassignedEnquiries, qualified, surveys, proposals, signed, pipeline, wonLost] = await Promise.all([
    Lead.countDocuments(leadMatch(range)),
    Lead.countDocuments({ ...leadMatch(range), owner: null }),
    countReached({ stage: 'qualified', ...range }),
    countReached({ stage: 'site_survey', ...range }),
    countReached({ stage: 'proposal_sent', ...range }),
    countReached({ stage: 'won', ...range }),
    getPipelineBlock({ ownerId: null }),
    getWonLostBlock({ year, month, ownerId: null }),
  ]);
  return {
    enquiries,
    unassignedEnquiries,
    qualified,
    surveys,
    proposals,
    signed,
    totalValueEgp: pipeline.totalValueEgp,
    totalWeightedValueEgp: pipeline.totalWeightedValueEgp,
    wonCount: wonLost.wonCount,
    lostCount: wonLost.lostCount,
  };
}

/**
 * The full Dashboard payload. `ownerId` null/undefined means "all owners" (MD/admin view); a
 * sales/technical caller should always pass their own id (enforced by the controller, never
 * trusted from the client) - see controller/crm/reportController.js. When `ownerId` is set,
 * `team` carries the SAME organization-wide totals the Pipeline board shows.
 */
async function getDashboard({ year, month, ownerId }) {
  const [targets, pipeline, speed, segmentQuality, wonLost, thisWeek, team] = await Promise.all([
    getTargetsBlock({ year, month, ownerId }),
    getPipelineBlock({ ownerId }),
    getSpeedBlock({ year, month, ownerId }),
    getSegmentQualityBlock({ year, month, ownerId }),
    getWonLostBlock({ year, month, ownerId }),
    getThisWeekBlock({ ownerId }),
    ownerId ? getTeamTotals({ year, month }) : null,
  ]);
  return { year, month, owner: ownerId || null, targets, pipeline, speed, segmentQuality, wonLost, thisWeek, team };
}

module.exports = {
  getDashboard,
  getTargetsBlock,
  getPipelineBlock,
  getSpeedBlock,
  getSegmentQualityBlock,
  getWonLostBlock,
  getThisWeekBlock,
  getTeamTotals,
  reachedStageLeads,
  originInRange,
  leadMatch,
  summarizeSpend,
  monthBounds,
  median,
  average,
  FUNNEL_ORDER,
};
