const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Dashboard (acceptance report section 4) - seeds leads/stage-history/targets/ad-spend with KNOWN
// values and hand-checks every figure, the report's own acceptance style ("every figure matches a
// manual count"). Same TEST_DB_URI self-skip convention as the rest of this suite.
//
// Mongoose's `{ timestamps: true }` overwrites `createdAt` with the real current time on
// `.create()`, regardless of what's passed in, AND strips any explicit `createdAt` from a normal
// `findByIdAndUpdate()` too (verified empirically - it silently no-ops rather than erroring).
// Every seeded Lead/StageHistory below is created first, then its `createdAt` is forced to the
// intended test date via a RAW collection update (`Model.collection.updateOne`), which bypasses
// Mongoose's schema/middleware layer entirely and is the only way that actually works.

const DB_URI = process.env.TEST_DB_URI;
const RUN = !!DB_URI;
const maybeTest = RUN ? test : test.skip;

let Lead, StageHistory, CrmTarget, CrmAdSpend, reportService;

before(async () => {
  if (!RUN) return;
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  require('../../models/userModel');
  Lead = require('../../models/crm/leadModel');
  StageHistory = require('../../models/crm/stageHistoryModel');
  require('../../models/crm/activityModel');
  CrmTarget = require('../../models/crm/targetModel');
  CrmAdSpend = require('../../models/crm/adSpendModel');
  await Promise.all([Lead.init(), StageHistory.init(), CrmTarget.init(), CrmAdSpend.init()]);
  reportService = require('../../services/crm/reportService');
});

after(async () => {
  if (!RUN) return;
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  if (!RUN) return;
  await Promise.all([Lead.deleteMany({}), StageHistory.deleteMany({}), CrmTarget.deleteMany({}), CrmAdSpend.deleteMany({})]);
});

let seq = 0;
function minimalLead(overrides = {}) {
  seq += 1;
  return {
    refCode: `RSV-TEST-${seq}`,
    phoneE164: `+2010${String(10000000 + seq).padStart(8, '0')}`,
    channel: 'phone',
    replyDueAt: new Date(),
    ampDeviceId: `test-device-${seq}-aaaaaaaa`,
    stage: 'new',
    valueEgp: 0,
    source: 'Other',
    segment: 'other',
    ...overrides,
  };
}

/** Creates a Lead, then forces createdAt to `when` (see header comment for why this is needed). */
async function createLeadAt(fields, when) {
  const lead = await Lead.create(minimalLead(fields));
  await Lead.collection.updateOne({ _id: lead._id }, { $set: { createdAt: when } });
  lead.createdAt = when;
  return lead;
}

/** Creates a StageHistory entry, then forces createdAt to `when`. */
async function createStageHistoryAt(fields, when) {
  const [entry] = await StageHistory.create([fields]);
  await StageHistory.collection.updateOne({ _id: entry._id }, { $set: { createdAt: when } });
  entry.createdAt = when;
  return entry;
}

const OWNER_A = new mongoose.Types.ObjectId();
const OWNER_B = new mongoose.Types.ObjectId();
const d = (day, hour = 0) => new Date(Date.UTC(2026, 0, day, hour)); // January 2026

maybeTest('getTargetsBlock: actual funnel counts match a hand count; a field with no target set reports null, not zero', async () => {
  // L1: owner A, villa, reaches qualified on the 7th.
  const l1 = await createLeadAt({ owner: OWNER_A, segment: 'villa' }, d(5));
  await createStageHistoryAt({ lead: l1._id, from: null, to: 'new' }, d(5));
  await createStageHistoryAt({ lead: l1._id, from: 'new', to: 'qualified' }, d(7));

  // L2: owner A, villa, created 10th, qualified on 12th, proposal on 15th, won on 20th.
  const l2 = await createLeadAt({ owner: OWNER_A, segment: 'villa', stage: 'won' }, d(10));
  await createStageHistoryAt({ lead: l2._id, from: null, to: 'new' }, d(10));
  await createStageHistoryAt({ lead: l2._id, from: 'new', to: 'qualified' }, d(12));
  await createStageHistoryAt({ lead: l2._id, from: 'qualified', to: 'proposal_sent' }, d(15));
  await createStageHistoryAt({ lead: l2._id, from: 'proposal_sent', to: 'won', valueEgpAtChange: 500000 }, d(20));

  // L3: owner B, farm - must never count toward owner A's totals.
  await createLeadAt({ owner: OWNER_B, segment: 'farm' }, d(2));

  await CrmTarget.create({ owner: OWNER_A, year: 2026, month: 1, targetEnquiries: 2, targetQualified: 2, targetSigned: 1, targetValueEgp: 400000 });

  const result = await reportService.getTargetsBlock({ year: 2026, month: 1, ownerId: String(OWNER_A) });

  assert.equal(result.enquiries.actual, 2, "only owner A's 2 leads, not owner B's");
  assert.equal(result.enquiries.target, 2);
  assert.equal(result.qualified.actual, 2, 'both L1 and L2 reached qualified in January');
  assert.equal(result.qualified.target, 2);
  assert.equal(result.surveys.actual, 0);
  assert.equal(result.surveys.target, null, 'no survey target was ever set - null, not 0');
  assert.equal(result.proposals.actual, 1, 'only L2 reached proposal_sent');
  assert.equal(result.signed.actual, 1, 'only L2 reached won');
  assert.equal(result.signed.target, 1);
  assert.equal(result.valueEgp.target, 400000);
});

maybeTest('getTargetsBlock: with no owner filter, targets sum across every owner who has one set', async () => {
  await CrmTarget.create({ owner: OWNER_A, year: 2026, month: 2, targetSigned: 2 });
  await CrmTarget.create({ owner: OWNER_B, year: 2026, month: 2, targetSigned: 3 });

  const result = await reportService.getTargetsBlock({ year: 2026, month: 2, ownerId: null });
  assert.equal(result.signed.target, 5);
});

maybeTest('getPipelineBlock: weighted value matches hand calculation, Won/Lost excluded, owner-filtered', async () => {
  await createLeadAt({ owner: OWNER_A, stage: 'qualified', valueEgp: 200000 }, d(5));
  await createLeadAt({ owner: OWNER_A, stage: 'won', valueEgp: 999999 }, d(5));
  await createLeadAt({ owner: OWNER_B, stage: 'qualified', valueEgp: 500000 }, d(5));

  const result = await reportService.getPipelineBlock({ ownerId: String(OWNER_A) });
  const qualifiedRow = result.stages.find(s => s.stage === 'qualified');
  assert.equal(qualifiedRow.count, 1, "owner B's lead must not be counted");
  assert.equal(qualifiedRow.valueEgp, 200000);
  assert.equal(qualifiedRow.weightedValueEgp, 50000, '200,000 * 25%');
  assert.equal(result.totalWeightedValueEgp, 50000, 'Won is excluded from the open-pipeline total');
});

maybeTest('getSpeedBlock: SLA breach and average hours to first reply match a hand calculation', async () => {
  const now = new Date();
  // Past the 8-hour SLA, never replied, still open - counts as a breach.
  await createLeadAt({ owner: OWNER_A, stage: 'new', replyDueAt: new Date(now.getTime() - 3600000), firstReplyAt: null }, d(5));

  // Replied exactly 4 hours after creation.
  await createLeadAt({ owner: OWNER_A, stage: 'contacted', replyDueAt: d(10, 8), firstReplyAt: d(10, 4) }, d(10, 0));

  const result = await reportService.getSpeedBlock({ year: 2026, month: 1, ownerId: String(OWNER_A) });
  assert.equal(result.leadsPastSlaLimit, 1);
  assert.equal(result.avgHoursToFirstReply, 4);
  assert.equal(result.pctWithinSla, 100);
});

maybeTest('getSourceQualityBlock: cost per qualified lead = monthly spend / qualified count; null with no spend entered', async () => {
  const l1 = await createLeadAt({ owner: OWNER_A, source: 'Google Ads' }, d(5));
  await createStageHistoryAt({ lead: l1._id, from: 'new', to: 'qualified' }, d(7));

  const l2 = await createLeadAt({ owner: OWNER_A, source: 'Google Ads' }, d(6));
  await createStageHistoryAt({ lead: l2._id, from: 'new', to: 'qualified' }, d(8));

  await createLeadAt({ owner: OWNER_A, source: 'Organic' }, d(6));

  await CrmAdSpend.create({ source: 'Google Ads', year: 2026, month: 1, amountEgp: 7000 });

  const result = await reportService.getSourceQualityBlock({ year: 2026, month: 1, ownerId: String(OWNER_A) });
  const google = result.sources.find(s => s.source === 'Google Ads');
  const organic = result.sources.find(s => s.source === 'Organic');

  assert.equal(google.leads, 2);
  assert.equal(google.qualified, 2);
  assert.equal(google.costPerQualifiedLead, 3500, '7000 / 2');
  assert.equal(google.overCostLimit, false, 'exactly at the limit, not over it');
  assert.equal(organic.costPerQualifiedLead, null, 'no spend was ever entered for Organic this month');
});

maybeTest('getWonLostBlock: win rate by segment and median days to close match a hand calculation', async () => {
  const lWon1 = await createLeadAt({ owner: OWNER_A, segment: 'villa' }, d(1));
  await createStageHistoryAt({ lead: lWon1._id, from: 'negotiation', to: 'won' }, d(11)); // 10 days

  const lWon2 = await createLeadAt({ owner: OWNER_A, segment: 'villa' }, d(1));
  await createStageHistoryAt({ lead: lWon2._id, from: 'negotiation', to: 'won' }, d(21)); // 20 days

  const lLost = await createLeadAt({ owner: OWNER_A, segment: 'villa' }, d(1));
  await createStageHistoryAt({ lead: lLost._id, from: 'contacted', to: 'lost', lostReason: 'Price' }, d(5));

  const result = await reportService.getWonLostBlock({ year: 2026, month: 1, ownerId: String(OWNER_A) });
  const villa = result.winRateBySegment.find(s => s.segment === 'villa');
  assert.equal(villa.won, 2);
  assert.equal(villa.lost, 1);
  assert.equal(villa.winRatePct, Math.round((2 / 3) * 1000) / 10);
  assert.equal(result.medianDaysToClose, 15, 'median of 10 and 20 days');
  assert.deepEqual(result.lostReasonsRanked, [{ reason: 'Price', count: 1 }]);

  // Every one of the 7 segments is always present, even at zero.
  const compound = result.winRateBySegment.find(s => s.segment === 'compound');
  assert.ok(compound);
  assert.equal(compound.won, 0);
  assert.equal(compound.winRatePct, null, 'no deals at all - a dash, never a fabricated 0%');
});

maybeTest('getThisWeekBlock: only leads from the last 7 days count, and the oldest unanswered lead comes first', async () => {
  const now = new Date();
  const recent = new Date(now.getTime() - 2 * 86400000);
  const old = new Date(now.getTime() - 30 * 86400000);

  await createLeadAt({ owner: OWNER_A, firstReplyAt: null, stage: 'new' }, recent);
  const lOldUnanswered = await createLeadAt({ owner: OWNER_A, firstReplyAt: null, stage: 'new' }, old);

  const result = await reportService.getThisWeekBlock({ ownerId: String(OWNER_A) });
  assert.equal(result.newLeads, 1, 'only the lead created within the last 7 days');
  assert.equal(result.oldestUnanswered.length, 2, 'both open+unanswered leads regardless of age');
  assert.equal(String(result.oldestUnanswered[0]._id), String(lOldUnanswered._id), 'the 30-day-old lead is older, so it sorts first');
});
