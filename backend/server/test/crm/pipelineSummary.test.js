const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Acceptance report finding 6: "Open pipeline total shows 1,500 EGP, ignores stage weights. Fix:
// weighted value (weights 5/10/25/40/55/75%)." Exercises GET /leads/pipeline's real controller
// (controller/crm/leadController.js#getPipelineSummary) against seeded leads with known valueEgp
// per stage, and hand-checks weightedValueEgp = valueEgp * the stage's published weight - the
// report's own acceptance style ("every figure matches a manual count"). Same TEST_DB_URI
// self-skip convention as every other CRM DB test in this suite (test/crm/leadService.test.js).

const DB_URI = process.env.TEST_DB_URI;
const RUN = !!DB_URI;
const maybeTest = RUN ? test : test.skip;

let Lead, getPipelineSummary;

before(async () => {
  if (!RUN) return;
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  require('../../models/userModel');
  Lead = require('../../models/crm/leadModel');
  require('../../models/crm/activityModel');
  await Lead.init();
  ({ getPipelineSummary } = require('../../controller/crm/leadController'));
});

after(async () => {
  if (!RUN) return;
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  if (!RUN) return;
  await Lead.deleteMany({});
});

function mockRes() {
  return {
    statusCode: null,
    body: null,
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    },
  };
}

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
    ...overrides,
  };
}

maybeTest('weightedValueEgp = valueEgp * the stage\'s published weight, per open stage', async () => {
  await Lead.create([
    minimalLead({ stage: 'new', valueEgp: 100000 }), // 5% -> 5,000
    minimalLead({ stage: 'contacted', valueEgp: 200000 }), // 10% -> 20,000
    minimalLead({ stage: 'qualified', valueEgp: 400000 }), // 25% -> 100,000
    minimalLead({ stage: 'site_survey', valueEgp: 500000 }), // 40% -> 200,000
    minimalLead({ stage: 'proposal_sent', valueEgp: 600000 }), // 55% -> 330,000
    minimalLead({ stage: 'negotiation', valueEgp: 1000000 }), // 75% -> 750,000
  ]);

  const res = mockRes();
  await getPipelineSummary({}, res);
  const byStage = Object.fromEntries(res.body.data.map(r => [r.stage, r]));

  assert.equal(byStage.new.weightedValueEgp, 5000);
  assert.equal(byStage.contacted.weightedValueEgp, 20000);
  assert.equal(byStage.qualified.weightedValueEgp, 100000);
  assert.equal(byStage.site_survey.weightedValueEgp, 200000);
  assert.equal(byStage.proposal_sent.weightedValueEgp, 330000);
  assert.equal(byStage.negotiation.weightedValueEgp, 750000);
});

maybeTest('Won and Lost never contribute to the weighted total - already-realized revenue is not a forecast', async () => {
  await Lead.create([minimalLead({ stage: 'won', valueEgp: 9999999 }), minimalLead({ stage: 'lost', valueEgp: 9999999 })]);

  const res = mockRes();
  await getPipelineSummary({}, res);
  const byStage = Object.fromEntries(res.body.data.map(r => [r.stage, r]));

  assert.equal(byStage.won.weightedValueEgp, 0);
  assert.equal(byStage.lost.weightedValueEgp, 0);
  // The raw (unweighted) figure is untouched - still real information, just not "pipeline forecast".
  assert.equal(byStage.won.valueEgp, 9999999);
});

maybeTest('a stage with no leads reports zero, not a missing key - the dashboard always has all stages to render', async () => {
  await Lead.create([minimalLead({ stage: 'new', valueEgp: 100000 })]);

  const res = mockRes();
  await getPipelineSummary({}, res);
  const byStage = Object.fromEntries(res.body.data.map(r => [r.stage, r]));

  assert.equal(byStage.negotiation.count, 0);
  assert.equal(byStage.negotiation.valueEgp, 0);
  assert.equal(byStage.negotiation.weightedValueEgp, 0);
});

maybeTest('an archived lead is excluded from both the raw and weighted totals', async () => {
  await Lead.create([
    minimalLead({ stage: 'negotiation', valueEgp: 1000000 }),
    minimalLead({ stage: 'negotiation', valueEgp: 1000000, archived: true, archivedAt: new Date() }),
  ]);

  const res = mockRes();
  await getPipelineSummary({}, res);
  const byStage = Object.fromEntries(res.body.data.map(r => [r.stage, r]));

  assert.equal(byStage.negotiation.count, 1);
  assert.equal(byStage.negotiation.valueEgp, 1000000);
  assert.equal(byStage.negotiation.weightedValueEgp, 750000);
});
