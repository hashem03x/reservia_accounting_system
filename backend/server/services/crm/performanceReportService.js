'use strict';
const mongoose = require('mongoose');
const Lead = require('../../models/crm/leadModel');
const StageHistory = require('../../models/crm/stageHistoryModel');
const CrmTarget = require('../../models/crm/targetModel');
const CrmAdSpend = require('../../models/crm/adSpendModel');
const { SEGMENTS } = require('../../utils/crm/constants');
const { monthBounds, median, average } = require('./reportService');

// Reservia CRM - the Performance tab (acceptance report section 5). Sits entirely on real stage
// history and lead data - "no new data entry needed except lost reason and monthly ad spend",
// matching the report's own description. Every rate/average here is computed from real documents,
// never fabricated; where phase 2 data (quotations, discounts) doesn't exist yet, the function
// returns an explicit `available: false` rather than a zero or guessed number.

const FUNNEL = ['new', 'contacted', 'qualified', 'site_survey', 'proposal_sent', 'negotiation', 'won'];
const ALL_SEGMENTS = SEGMENTS.filter(s => s !== 'unknown');
// "Below 10 closed deals in a group: show count beside every rate" - sampleSize travels with
// every rate so the frontend can render "(n=3)" instead of implying statistical confidence a
// 3-deal sample doesn't have.
const SMALL_SAMPLE_THRESHOLD = 10;

function ownerLookupStage(ownerId) {
  return [
    { $lookup: { from: 'crmleads', localField: 'lead', foreignField: '_id', as: 'leadDoc' } },
    { $unwind: '$leadDoc' },
    ...(ownerId ? [{ $match: { 'leadDoc.owner': new mongoose.Types.ObjectId(ownerId) } }] : []),
  ];
}

function leadIdsFilter({ start, end, ownerId, segment }) {
  const match = { createdAt: { $gte: start, $lt: end }, archived: { $ne: true } };
  if (ownerId) match.owner = new mongoose.Types.ObjectId(ownerId);
  if (segment) match.segment = segment;
  return match;
}

/**
 * A.1/A.5: per-lead, per-stage time spent, and currently-open "stuck" leads. Walks each lead's
 * own StageHistory in order - the duration attributed to stage X is the gap between the event that
 * moved the lead INTO X and whichever event (or "now", if X is still current) came next for that
 * SAME lead. Pulls each in-scope lead's FULL history (not just events that happened to fall inside
 * the selected month) - a lead created in the period keeps its whole story.
 */
async function computeStageDurations({ year, month, ownerId, segment }) {
  const { start, end } = monthBounds(year, month);
  const leads = await Lead.find(leadIdsFilter({ start, end, ownerId, segment }))
    .select('_id segment stage')
    .lean();
  const leadIds = leads.map(l => l._id);
  const segmentByLead = Object.fromEntries(leads.map(l => [String(l._id), l.segment || 'other']));
  if (leadIds.length === 0) return { durations: [], stuckLeads: [] };

  const history = await StageHistory.find({ lead: { $in: leadIds } })
    .sort({ lead: 1, createdAt: 1 })
    .select('lead to createdAt')
    .lean();

  const now = new Date();
  const byLead = new Map();
  for (const h of history) {
    const key = String(h.lead);
    if (!byLead.has(key)) byLead.set(key, []);
    byLead.get(key).push(h);
  }

  const durations = []; // { leadId, stage, segment, days, isCurrent }
  for (const [leadId, events] of byLead) {
    for (let i = 0; i < events.length; i += 1) {
      const startAt = events[i].createdAt;
      const endAt = i + 1 < events.length ? events[i + 1].createdAt : now;
      const days = (endAt - startAt) / 86400000;
      durations.push({ leadId, stage: events[i].to, segment: segmentByLead[leadId] || 'other', days, isCurrent: i === events.length - 1 });
    }
  }

  // Stuck leads: open leads whose CURRENT stage duration exceeds 2x that stage's median duration
  // (computed from this same set - a locally-relevant baseline, not a hardcoded number of days).
  const byStage = {};
  for (const d of durations) {
    byStage[d.stage] = byStage[d.stage] || [];
    byStage[d.stage].push(d.days);
  }
  const medianByStage = Object.fromEntries(Object.entries(byStage).map(([stage, days]) => [stage, median(days)]));

  const openLeadsById = Object.fromEntries(leads.filter(l => !['won', 'lost'].includes(l.stage)).map(l => [String(l._id), l]));
  const stuckLeads = durations
    .filter(d => d.isCurrent && openLeadsById[d.leadId] && medianByStage[d.stage] != null && d.days > 2 * medianByStage[d.stage])
    .map(d => ({ leadId: d.leadId, stage: d.stage, days: Math.round(d.days * 10) / 10, medianDaysForStage: Math.round(medianByStage[d.stage] * 10) / 10 }));

  return { durations, stuckLeads };
}

/** A: Speed - days in each stage (avg/median, split by segment), hours to first reply, days to quote, days to close, stuck leads. */
async function getSpeedSection({ year, month, ownerId, segment }) {
  const { start, end } = monthBounds(year, month);
  const filter = leadIdsFilter({ start, end, ownerId, segment });

  const { durations, stuckLeads } = await computeStageDurations({ year, month, ownerId, segment });

  const daysInStage = FUNNEL.filter(s => s !== 'won').map(stage => {
    const days = durations.filter(d => d.stage === stage).map(d => d.days);
    const bySegment = ALL_SEGMENTS.map(seg => {
      const segDays = durations.filter(d => d.stage === stage && d.segment === seg).map(d => d.days);
      return { segment: seg, avgDays: segDays.length ? Math.round(average(segDays) * 10) / 10 : null, sampleSize: segDays.length };
    });
    return { stage, avgDays: days.length ? Math.round(average(days) * 10) / 10 : null, medianDays: days.length ? Math.round(median(days) * 10) / 10 : null, sampleSize: days.length, bySegment };
  });

  const repliedLeads = await Lead.find({ ...filter, firstReplyAt: { $ne: null } })
    .select('createdAt firstReplyAt')
    .lean();
  const replyHours = repliedLeads.map(l => (l.firstReplyAt - l.createdAt) / 36e5);
  const hoursToFirstReply = {
    avgHours: replyHours.length ? Math.round(average(replyHours) * 10) / 10 : null,
    medianHours: replyHours.length ? Math.round(median(replyHours) * 10) / 10 : null,
    pctWithin8h: replyHours.length ? Math.round((replyHours.filter(h => h <= 8).length / replyHours.length) * 1000) / 10 : null,
    sampleSize: replyHours.length,
  };

  // Days to quote: created -> first `proposal_sent` transition (the report's own stand-in "until
  // quotation module exists").
  const proposalEvents = await StageHistory.aggregate([
    { $match: { to: 'proposal_sent' } },
    ...ownerLookupStage(ownerId),
    { $match: { 'leadDoc.createdAt': { $gte: start, $lt: end }, ...(segment ? { 'leadDoc.segment': segment } : {}) } },
    { $group: { _id: '$lead', firstProposalAt: { $min: '$createdAt' }, createdAt: { $first: '$leadDoc.createdAt' }, segment: { $first: '$leadDoc.segment' } } },
  ]);
  const daysToQuoteAll = proposalEvents.map(e => (e.firstProposalAt - e.createdAt) / 86400000);
  const daysToQuote = {
    avgDays: daysToQuoteAll.length ? Math.round(average(daysToQuoteAll) * 10) / 10 : null,
    medianDays: daysToQuoteAll.length ? Math.round(median(daysToQuoteAll) * 10) / 10 : null,
    sampleSize: daysToQuoteAll.length,
    bySegment: ALL_SEGMENTS.map(seg => {
      const segDays = proposalEvents.filter(e => (e.segment || 'other') === seg).map(e => (e.firstProposalAt - e.createdAt) / 86400000);
      return { segment: seg, avgDays: segDays.length ? Math.round(average(segDays) * 10) / 10 : null, sampleSize: segDays.length };
    }),
  };

  const wonEvents = await StageHistory.aggregate([
    { $match: { to: 'won' } },
    ...ownerLookupStage(ownerId),
    { $match: { 'leadDoc.createdAt': { $gte: start, $lt: end }, ...(segment ? { 'leadDoc.segment': segment } : {}) } },
  ]);
  const daysToCloseAll = wonEvents.map(e => (e.createdAt - e.leadDoc.createdAt) / 86400000);
  const daysToClose = {
    avgDays: daysToCloseAll.length ? Math.round(average(daysToCloseAll) * 10) / 10 : null,
    medianDays: daysToCloseAll.length ? Math.round(median(daysToCloseAll) * 10) / 10 : null,
    sampleSize: daysToCloseAll.length,
    bySegment: ALL_SEGMENTS.map(seg => {
      const segDays = wonEvents.filter(e => (e.leadDoc.segment || 'other') === seg).map(e => (e.createdAt - e.leadDoc.createdAt) / 86400000);
      return { segment: seg, avgDays: segDays.length ? Math.round(average(segDays) * 10) / 10 : null, sampleSize: segDays.length };
    }),
  };

  return { daysInStage, hoursToFirstReply, daysToQuote, daysToClose, stuckLeads };
}

/** B: Conversion - stage funnel, win rate, loss rate+reasons, quote-to-win (unavailable), lead-to-signed. */
async function getConversionSection({ year, month, ownerId, segment }) {
  const { start, end } = monthBounds(year, month);

  const reachedCount = async stage => {
    const rows = await StageHistory.aggregate([
      { $match: { to: stage, createdAt: { $gte: start, $lt: end } } },
      ...ownerLookupStage(ownerId),
      ...(segment ? [{ $match: { 'leadDoc.segment': segment } }] : []),
      { $group: { _id: '$lead' } },
    ]);
    return rows.length;
  };

  const counts = Object.fromEntries(await Promise.all(FUNNEL.map(async stage => [stage, await reachedCount(stage)])));
  const funnel = FUNNEL.map((stage, i) => {
    const prevStage = i === 0 ? null : FUNNEL[i - 1];
    const pctFromPrev = prevStage == null || counts[prevStage] === 0 ? null : Math.round((counts[stage] / counts[prevStage]) * 1000) / 10;
    return { stage, count: counts[stage], pctFromPreviousStage: pctFromPrev };
  });

  const wonRows = await StageHistory.aggregate([
    { $match: { to: 'won', createdAt: { $gte: start, $lt: end } } },
    ...ownerLookupStage(ownerId),
  ]);
  const lostRows = await StageHistory.aggregate([
    { $match: { to: 'lost', createdAt: { $gte: start, $lt: end } } },
    ...ownerLookupStage(ownerId),
  ]);

  function rateBy(key) {
    const groups = {};
    for (const e of wonRows) {
      const k = e.leadDoc[key] || 'other';
      groups[k] = groups[k] || { won: 0, lost: 0 };
      groups[k].won += 1;
    }
    for (const e of lostRows) {
      const k = e.leadDoc[key] || 'other';
      groups[k] = groups[k] || { won: 0, lost: 0 };
      groups[k].lost += 1;
    }
    return Object.entries(groups).map(([k, { won, lost }]) => ({
      [key]: k,
      won,
      lost,
      sampleSize: won + lost,
      winRatePct: won + lost === 0 ? null : Math.round((won / (won + lost)) * 1000) / 10,
    }));
  }

  const winRateBySegment = ALL_SEGMENTS.map(seg => {
    const won = wonRows.filter(e => (e.leadDoc.segment || 'other') === seg).length;
    const lost = lostRows.filter(e => (e.leadDoc.segment || 'other') === seg).length;
    return { segment: seg, won, lost, sampleSize: won + lost, winRatePct: won + lost === 0 ? null : Math.round((won / (won + lost)) * 1000) / 10 };
  });
  const winRateBySource = rateBy('source');
  const winRateByOwner = rateBy('owner');

  const lostReasonCounts = {};
  const lostByStage = {};
  for (const e of lostRows) {
    const reason = e.lostReason || 'Other';
    lostReasonCounts[reason] = (lostReasonCounts[reason] || 0) + 1;
    const fromStage = e.from || 'unknown';
    lostByStage[fromStage] = (lostByStage[fromStage] || 0) + 1;
  }
  const lostReasonsRanked = Object.entries(lostReasonCounts)
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);
  const lostByStageChart = Object.entries(lostByStage).map(([stage, count]) => ({ stage, count }));

  const totalWon = wonRows.length;
  const totalLost = lostRows.length;
  const lossRatePct = totalWon + totalLost === 0 ? null : Math.round((totalLost / (totalWon + totalLost)) * 1000) / 10;

  const enquiriesCount = await Lead.countDocuments(leadIdsFilter({ start, end, ownerId, segment }));
  const leadToSignedPct = enquiriesCount === 0 ? null : Math.round((totalWon / enquiriesCount) * 1000) / 10;

  return {
    funnel,
    winRateBySegment,
    winRateBySource,
    winRateByOwner,
    lossRatePct,
    lostReasonsRanked,
    lostByStageChart,
    // Phase 2 - no quotation acceptance data to compute a real rate from yet; an explicit
    // unavailable state, never a fabricated number (acceptance report section 5B).
    quoteToWin: { available: false, reason: 'Quotations are not yet live - see Phase 2 (due 2026-12-10).' },
    leadToSigned: { signed: totalWon, enquiries: enquiriesCount, pct: leadToSignedPct },
  };
}

/** C: Value and cost - average deal size, average discount (unavailable), pipeline coverage, cost per qualified/signed lead. */
async function getValueCostSection({ year, month, ownerId, segment }) {
  const { start, end } = monthBounds(year, month);

  const wonRows = await StageHistory.aggregate([
    { $match: { to: 'won', createdAt: { $gte: start, $lt: end } } },
    ...ownerLookupStage(ownerId),
    ...(segment ? [{ $match: { 'leadDoc.segment': segment } }] : []),
  ]);

  const averageDealSizeBySegment = ALL_SEGMENTS.map(seg => {
    const values = wonRows.filter(e => (e.leadDoc.segment || 'other') === seg).map(e => e.valueEgpAtChange ?? e.leadDoc.valueEgp ?? 0);
    return { segment: seg, avgDealSizeEgp: values.length ? Math.round(average(values)) : null, sampleSize: values.length };
  });

  // Pipeline coverage = weighted open pipeline (EGP) / remaining revenue target (EGP) - the
  // standard sales-ops "coverage ratio" (e.g. 2.5x means 2.5 times the weighted pipeline needed
  // to hit what's left of the target). Both sides must be EGP for the ratio to mean anything, so
  // this reads CrmTarget.targetValueEgp, not targetSigned (a deal COUNT, a different unit).
  // null/undefined (not zero/red) when no EGP target was ever set - a missing target is not
  // "failing coverage" - and also null once the target is already met (nothing left to cover).
  const actualSigned = wonRows.length;
  const actualSignedValueEgp = wonRows.reduce((sum, e) => sum + (e.valueEgpAtChange ?? e.leadDoc.valueEgp ?? 0), 0);
  const targetFilter = { year, month };
  if (ownerId) targetFilter.owner = ownerId;
  const targets = await CrmTarget.find(targetFilter).lean();
  const targetValueSum = targets.some(t => t.targetValueEgp != null) ? targets.reduce((sum, t) => sum + (t.targetValueEgp || 0), 0) : null;
  const remainingTargetEgp = targetValueSum == null ? null : Math.max(targetValueSum - actualSignedValueEgp, 0);

  const { getPipelineBlock } = require('./reportService');
  const pipeline = await getPipelineBlock({ ownerId });
  const pipelineCoverage =
    remainingTargetEgp == null || remainingTargetEgp === 0 ? null : Math.round((pipeline.totalWeightedValueEgp / remainingTargetEgp) * 100) / 100;

  const spendRows = await CrmAdSpend.find({ year, month }).lean();
  const totalSpend = spendRows.reduce((sum, s) => sum + s.amountEgp, 0);
  const qualifiedCount = await StageHistory.aggregate([
    { $match: { to: 'qualified', createdAt: { $gte: start, $lt: end } } },
    ...ownerLookupStage(ownerId),
    { $group: { _id: '$lead' } },
  ]).then(rows => rows.length);

  return {
    averageDealSizeBySegment,
    averageDiscount: { available: false, reason: 'Discounts are not tracked until quotations go live - see Phase 2 (due 2026-12-10).' },
    pipelineCoverage: {
      weightedPipelineEgp: pipeline.totalWeightedValueEgp,
      remainingTargetEgp,
      ratio: pipelineCoverage,
      belowOne: pipelineCoverage != null && pipelineCoverage < 1,
    },
    costPerQualifiedLeadEgp: totalSpend === 0 || qualifiedCount === 0 ? null : Math.round((totalSpend / qualifiedCount) * 100) / 100,
    costPerSignedDealEgp: totalSpend === 0 || actualSigned === 0 ? null : Math.round((totalSpend / actualSigned) * 100) / 100,
  };
}

async function getPerformance({ year, month, ownerId, segment }) {
  const [speed, conversion, valueCost] = await Promise.all([
    getSpeedSection({ year, month, ownerId, segment }),
    getConversionSection({ year, month, ownerId, segment }),
    getValueCostSection({ year, month, ownerId, segment }),
  ]);
  return { year, month, owner: ownerId || null, segment: segment || null, speed, conversion, valueCost };
}

module.exports = { getPerformance, getSpeedSection, getConversionSection, getValueCostSection, computeStageDurations, SMALL_SAMPLE_THRESHOLD };
