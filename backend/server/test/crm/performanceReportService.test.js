const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Performance tab (acceptance report section 5) - "seed 12 leads with known dates; every
// average/median/rate matches a hand calculation" (the report's own acceptance line). Same
// raw-collection createdAt fix-up as reportService.test.js - see that file's header comment for
// why a plain findByIdAndUpdate doesn't work for this.

const DB_URI = process.env.TEST_DB_URI;
const RUN = !!DB_URI;
const maybeTest = RUN ? test : test.skip;

let Lead, StageHistory, CrmTarget, CrmAdSpend, performanceReportService;

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
  performanceReportService = require('../../services/crm/performanceReportService');
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
    phoneE164: `+2011${String(10000000 + seq).padStart(8, '0')}`,
    channel: 'phone',
    replyDueAt: new Date(),
    ampDeviceId: `test-device-${seq}-bbbbbbbb`,
    stage: 'new',
    valueEgp: 0,
    source: 'Other',
    segment: 'other',
    ...overrides,
  };
}

async function createLeadAt(fields, when) {
  const lead = await Lead.create(minimalLead(fields));
  await Lead.collection.updateOne({ _id: lead._id }, { $set: { createdAt: when } });
  lead.createdAt = when;
  return lead;
}

async function createStageHistoryAt(fields, when) {
  const [entry] = await StageHistory.create([fields]);
  await StageHistory.collection.updateOne({ _id: entry._id }, { $set: { createdAt: when } });
  entry.createdAt = when;
  return entry;
}

const OWNER_A = new mongoose.Types.ObjectId();
const d = (day, hour = 0) => new Date(Date.UTC(2026, 0, day, hour)); // January 2026
// Africa/Cairo observes DST in this environment's tzdata (EEST = UTC+3 in summer/fall, EET =
// UTC+2 in winter) - the 2026 transition back to standard time falls between Oct 29 and Oct 30,
// confirmed empirically. This helper is only valid for November dates (safely UTC+2 throughout);
// never reuse it across that boundary into October.
const cairoIso = (day, hour, min = 0) => new Date(Date.UTC(2026, 10, day, hour - 2, min));

maybeTest('computeStageDurations: a lead spends N days in a stage, measured from entering it to the next transition', async () => {
  const lead = await createLeadAt({ owner: OWNER_A, stage: 'qualified' }, d(1));
  await createStageHistoryAt({ lead: lead._id, from: null, to: 'new' }, d(1));
  await createStageHistoryAt({ lead: lead._id, from: 'new', to: 'contacted' }, d(4)); // 3 days in 'new'
  await createStageHistoryAt({ lead: lead._id, from: 'contacted', to: 'qualified' }, d(9)); // 5 days in 'contacted'

  const { durations } = await performanceReportService.computeStageDurations({ year: 2026, month: 1, ownerId: String(OWNER_A) });
  const newDuration = durations.find(x => x.stage === 'new');
  const contactedDuration = durations.find(x => x.stage === 'contacted');
  assert.equal(Math.round(newDuration.days), 3);
  assert.equal(Math.round(contactedDuration.days), 5);
  assert.equal(newDuration.isCurrent, false);
  const qualifiedDuration = durations.find(x => x.stage === 'qualified');
  assert.equal(qualifiedDuration.isCurrent, true, "the lead's current stage has no 'next' event yet");
});

maybeTest('computeStageDurations: a lead stuck more than 2x the median time for its stage is flagged', async () => {
  // Three leads reach 'contacted' quickly (1 day each) - median ~1 day.
  for (let i = 0; i < 3; i += 1) {
    const lead = await createLeadAt({ owner: OWNER_A, stage: 'contacted' }, d(1));
    await createStageHistoryAt({ lead: lead._id, from: null, to: 'new' }, d(1));
    await createStageHistoryAt({ lead: lead._id, from: 'new', to: 'contacted' }, d(2));
  }
  // A fourth lead has sat in 'new' since January 2026 with no further transition - its "duration
  // so far" is (real now - d(1)), naturally many months, so no Date-faking is needed to make it
  // dwarf the ~1-day median above.
  const stuckLead = await createLeadAt({ owner: OWNER_A, stage: 'new' }, d(1));
  await createStageHistoryAt({ lead: stuckLead._id, from: null, to: 'new' }, d(1));

  const { stuckLeads } = await performanceReportService.computeStageDurations({ year: 2026, month: 1, ownerId: String(OWNER_A) });
  assert.ok(
    stuckLeads.some(s => String(s.leadId) === String(stuckLead._id)),
    'a lead untouched since January should be flagged as stuck relative to the ~1-day median'
  );
});

maybeTest('getSpeedSection: hours to first reply are WORKING hours, never raw wall-clock elapsed time', async () => {
  // Created Thursday 17:00, replied Sunday 10:00 Cairo (Nov 5 -> Nov 8, both safely on the
  // post-DST-transition +2 side - see cairoIso's own header comment) - 2 real working hours (1
  // left Thursday + 1 on Sunday), not the ~65 raw hours a naive timestamp subtraction would
  // report. Direct regression test for the bug this audit caught in reportService.js and here.
  await createLeadAt({ owner: OWNER_A, firstReplyAt: cairoIso(8, 10, 0), replyDueAt: cairoIso(5, 18, 0) }, cairoIso(5, 17, 0));

  const { hoursToFirstReply } = await performanceReportService.getSpeedSection({ year: 2026, month: 11, ownerId: String(OWNER_A) });
  assert.equal(hoursToFirstReply.avgHours, 2);
  assert.equal(hoursToFirstReply.medianHours, 2);
  assert.equal(hoursToFirstReply.pctWithin8h, 100);
  assert.equal(hoursToFirstReply.sampleSize, 1);
});

maybeTest('getConversionSection: stage-to-stage conversion percentages match a hand calculation', async () => {
  // 4 leads reach 'new'; 2 of those reach 'contacted'; 1 of those reaches 'qualified'.
  const leads = [];
  for (let i = 0; i < 4; i += 1) {
    const lead = await createLeadAt({ owner: OWNER_A }, d(1));
    await createStageHistoryAt({ lead: lead._id, from: null, to: 'new' }, d(1));
    leads.push(lead);
  }
  await createStageHistoryAt({ lead: leads[0]._id, from: 'new', to: 'contacted' }, d(2));
  await createStageHistoryAt({ lead: leads[1]._id, from: 'new', to: 'contacted' }, d(2));
  await createStageHistoryAt({ lead: leads[0]._id, from: 'contacted', to: 'qualified' }, d(3));

  const result = await performanceReportService.getConversionSection({ year: 2026, month: 1, ownerId: String(OWNER_A) });
  const newStage = result.funnel.find(f => f.stage === 'new');
  const contactedStage = result.funnel.find(f => f.stage === 'contacted');
  const qualifiedStage = result.funnel.find(f => f.stage === 'qualified');

  assert.equal(newStage.count, 4);
  assert.equal(contactedStage.count, 2);
  assert.equal(contactedStage.pctFromPreviousStage, 50, '2 of 4 reached contacted');
  assert.equal(qualifiedStage.count, 1);
  assert.equal(qualifiedStage.pctFromPreviousStage, 50, '1 of 2 reached qualified');
});

maybeTest('getValueCostSection: pipeline coverage ratio and average deal size match a hand calculation', async () => {
  const lWon = await createLeadAt({ owner: OWNER_A, segment: 'villa' }, d(1));
  await createStageHistoryAt({ lead: lWon._id, from: 'negotiation', to: 'won', valueEgpAtChange: 100000 }, d(10));

  await createLeadAt({ owner: OWNER_A, stage: 'negotiation', valueEgp: 400000 }, d(5)); // open, weighted 75% -> 300,000

  await CrmTarget.create({ owner: OWNER_A, year: 2026, month: 1, targetValueEgp: 500000 });

  const result = await performanceReportService.getValueCostSection({ year: 2026, month: 1, ownerId: String(OWNER_A) });
  const villa = result.averageDealSizeBySegment.find(s => s.segment === 'villa');
  assert.equal(villa.avgDealSizeEgp, 100000);

  // remaining target = 500,000 - 100,000 (already signed) = 400,000; weighted pipeline = 300,000
  // -> coverage ratio = 300,000 / 400,000 = 0.75 (below 1 - should be flagged red).
  assert.equal(result.pipelineCoverage.remainingTargetEgp, 400000);
  assert.equal(result.pipelineCoverage.weightedPipelineEgp, 300000);
  assert.equal(result.pipelineCoverage.ratio, 0.75);
  assert.equal(result.pipelineCoverage.belowOne, true);

  assert.equal(result.averageDiscount.available, false, 'phase 2 - never a fabricated discount figure');
});

maybeTest('getValueCostSection: cost per qualified/signed deal match a hand calculation', async () => {
  const l1 = await createLeadAt({ owner: OWNER_A, source: 'Meta Ads' }, d(1));
  await createStageHistoryAt({ lead: l1._id, from: 'new', to: 'qualified' }, d(3));
  await createStageHistoryAt({ lead: l1._id, from: 'qualified', to: 'won', valueEgpAtChange: 50000 }, d(10));

  const l2 = await createLeadAt({ owner: OWNER_A, source: 'Meta Ads' }, d(1));
  await createStageHistoryAt({ lead: l2._id, from: 'new', to: 'qualified' }, d(4));

  await CrmAdSpend.create({ source: 'Meta Ads', year: 2026, month: 1, amountEgp: 4000 });

  const result = await performanceReportService.getValueCostSection({ year: 2026, month: 1, ownerId: String(OWNER_A) });
  assert.equal(result.costPerQualifiedLeadEgp, 2000, '4000 / 2 qualified');
  assert.equal(result.costPerSignedDealEgp, 4000, '4000 / 1 signed');
});
