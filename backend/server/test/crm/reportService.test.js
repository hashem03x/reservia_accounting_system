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
// Africa/Cairo observes DST in this environment's tzdata (EEST = UTC+3 in summer/fall, EET =
// UTC+2 in winter) - the 2026 transition back to standard time falls between Oct 29 and Oct 30,
// confirmed empirically. This helper is only valid for November dates (safely UTC+2 throughout);
// never reuse it across that boundary into October.
const cairoIso = (day, hour, min = 0) => new Date(Date.UTC(2026, 10, day, hour - 2, min));

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

  await CrmTarget.create({ segment: 'all', year: 2026, month: 1, targetEnquiries: 2, targetQualified: 2, targetSigned: 1, targetValueEgp: 400000 });

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

maybeTest('getTargetsBlock: always reads the single company-wide "all" segment target, regardless of which owner\'s actuals are being viewed', async () => {
  await CrmTarget.create({ segment: 'all', year: 2026, month: 2, targetSigned: 5 });
  // A specific segment's own target is a SEPARATE record - it must never leak into the "all" figure.
  await CrmTarget.create({ segment: 'farm', year: 2026, month: 2, targetSigned: 2 });

  const mdView = await reportService.getTargetsBlock({ year: 2026, month: 2, ownerId: null });
  assert.equal(mdView.signed.target, 5);

  const ownerView = await reportService.getTargetsBlock({ year: 2026, month: 2, ownerId: String(OWNER_A) });
  assert.equal(ownerView.signed.target, 5, 'the company-wide target is the same regardless of the owner scoping the ACTUAL counts');
});

maybeTest('getTargetsBlock: no target set for the month reports null for every field, never zero or a stale figure', async () => {
  const result = await reportService.getTargetsBlock({ year: 2026, month: 3, ownerId: null });
  assert.equal(result.enquiries.target, null);
  assert.equal(result.signed.target, null);
  assert.equal(result.valueEgp.target, null);
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

maybeTest('getSpeedBlock: SLA breach and average WORKING hours to first reply match a hand calculation', async () => {
  const now = new Date();
  // Past the 8-hour SLA, never replied, still open - counts as a breach. Created within
  // November so it falls inside this test's own month filter below.
  await createLeadAt({ owner: OWNER_A, stage: 'new', replyDueAt: new Date(now.getTime() - 3600000), firstReplyAt: null }, cairoIso(2, 10, 0));

  // Created Sunday 10:00, replied Sunday 14:00 Cairo - exactly 4 WORKING hours (same working
  // window, no weekend crossed) - this is the regression case for the bug this audit caught:
  // "hours to first reply" must use Cairo working hours, never raw wall-clock elapsed time.
  await createLeadAt({ owner: OWNER_A, stage: 'contacted', replyDueAt: cairoIso(1, 18, 0), firstReplyAt: cairoIso(1, 14, 0) }, cairoIso(1, 10, 0));

  const result = await reportService.getSpeedBlock({ year: 2026, month: 11, ownerId: String(OWNER_A) });
  assert.equal(result.leadsPastSlaLimit, 1);
  assert.equal(result.avgHoursToFirstReply, 4);
  assert.equal(result.pctWithinSla, 100);
});

maybeTest('getSpeedBlock: a reply that merely spans a weekend is never reported as a slow reply', async () => {
  // Created Thursday 17:00, replied Sunday 10:00 Cairo (Nov 5 -> Nov 8, both safely on the
  // post-DST-transition +2 side - see cairoIso's own header comment) - the brief's own boundary
  // scenario: only 2 real working hours passed (1 left Thursday + 1 on Sunday), well within the
  // 8-hour SLA, even though ~65 raw wall-clock hours elapsed.
  await createLeadAt({ owner: OWNER_A, stage: 'contacted', replyDueAt: cairoIso(5, 18, 0), firstReplyAt: cairoIso(8, 10, 0) }, cairoIso(5, 17, 0));

  const result = await reportService.getSpeedBlock({ year: 2026, month: 11, ownerId: String(OWNER_A) });
  assert.equal(result.avgHoursToFirstReply, 2, 'the weekend must not be counted as elapsed reply time');
  assert.equal(result.pctWithinSla, 100);
});

maybeTest('getSegmentQualityBlock: cost per qualified lead and cost per enquiry = monthly segment spend / count; null with no spend entered', async () => {
  const l1 = await createLeadAt({ owner: OWNER_A, segment: 'farm' }, d(5));
  await createStageHistoryAt({ lead: l1._id, from: 'new', to: 'qualified' }, d(7));

  const l2 = await createLeadAt({ owner: OWNER_A, segment: 'farm' }, d(6));
  await createStageHistoryAt({ lead: l2._id, from: 'new', to: 'qualified' }, d(8));

  await createLeadAt({ owner: OWNER_A, segment: 'villa' }, d(6));

  // Two differently-named channel line items both tagged 'farm' - their spend must be SUMMED for
  // the segment's cost-per-lead math (client's own real budget line items, e.g. "Farm test" and
  // "Farms" in different months, both roll up to the farm segment).
  await CrmAdSpend.create({ channel: 'Farm test', segment: 'farm', year: 2026, month: 1, amountEgp: 5000 });
  await CrmAdSpend.create({ channel: 'Farms extra', segment: 'farm', year: 2026, month: 1, amountEgp: 2000 });
  // Untagged spend (SEO/agency fees) must never be attributed to any one segment.
  await CrmAdSpend.create({ channel: 'SEO', year: 2026, month: 1, amountEgp: 1000 });

  const result = await reportService.getSegmentQualityBlock({ year: 2026, month: 1, ownerId: String(OWNER_A) });
  const farm = result.segments.find(s => s.segment === 'farm');
  const villa = result.segments.find(s => s.segment === 'villa');

  assert.equal(farm.leads, 2);
  assert.equal(farm.qualified, 2);
  assert.equal(farm.monthlySpendEgp, 7000, '5000 + 2000 summed across both farm-tagged channels');
  assert.equal(farm.costPerQualifiedLead, 3500, '7000 / 2');
  assert.equal(farm.costPerEnquiry, 3500, '7000 / 2 leads');
  assert.equal(farm.overCostLimit, false, 'exactly at the limit, not over it');
  assert.equal(villa.costPerQualifiedLead, null, 'no spend was ever entered for villa this month');
  assert.equal(villa.costPerEnquiry, null);
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

maybeTest('getTeamTotals: org-wide figures including every owner, deliberately narrower (aggregate-only) than the per-owner block', async () => {
  // Owner A's own lead, plus an UNASSIGNED lead (owner: null) and owner B's lead - getTeamTotals
  // must count all three; this is exactly the Feature 3 scenario ("the unassigned lead is missing
  // from the Dashboard") the org-wide `team` block exists to reconcile against.
  await createLeadAt({ owner: OWNER_A }, d(5));
  await createLeadAt({ owner: null }, d(6));
  await createLeadAt({ owner: OWNER_B }, d(7));

  const result = await reportService.getTeamTotals({ year: 2026, month: 1 });
  assert.equal(result.enquiries, 3, 'org-wide total includes the unassigned lead and both owners');
  assert.ok(!('oldestUnanswered' in result), 'deliberately aggregate-only - no individual lead details exposed');
});

maybeTest('getDashboard: the "team" block is present only for a single-owner view, and absent for the org-wide (MD) view', async () => {
  await createLeadAt({ owner: OWNER_A }, d(5));
  await createLeadAt({ owner: null }, d(6));

  const mdView = await reportService.getDashboard({ year: 2026, month: 1, ownerId: null });
  assert.equal(mdView.team, null, 'the MD view already sees everything - no separate reconciliation block needed');

  const ownerView = await reportService.getDashboard({ year: 2026, month: 1, ownerId: String(OWNER_A) });
  assert.ok(ownerView.team, 'a single-owner view gets the org-wide reconciliation figures');
  assert.equal(ownerView.team.enquiries, 2, 'org-wide count includes the unassigned lead, unlike this owner\'s own scoped targets.actual');
  assert.equal(ownerView.targets.enquiries.actual, 1, 'the scoped block itself still only counts this owner\'s own lead');
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
