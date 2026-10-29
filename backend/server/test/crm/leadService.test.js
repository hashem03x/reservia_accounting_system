const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Exercises services/crm/leadService.js against a REAL MongoDB connection - intakeLead and
// changeStage run inside session.withTransaction(), which requires an actual replica set (even a
// single-node one); a plain standalone mongod rejects `startTransaction` outright. This file must
// be run with TEST_DB_URI pointed at a replica-set member (see
// scripts/run-crm-transactional-tests.js, or any ad hoc single-node `--replSet` mongod) - it is
// skipped automatically otherwise so the rest of the suite stays runnable on a standalone dev DB,
// mirroring test/cashflow/cashFlowForecast.test.js's own note on this exact limitation.

const DB_URI = process.env.TEST_DB_URI;
const RUN = !!DB_URI;

let Lead, Activity, StageHistory, leadService;

before(async () => {
  if (!RUN) return;
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  require('../../models/userModel');
  Lead = require('../../models/crm/leadModel');
  Activity = require('../../models/crm/activityModel');
  StageHistory = require('../../models/crm/stageHistoryModel');
  leadService = require('../../services/crm/leadService');
  await Lead.init();
  await Activity.init();
  await StageHistory.init();
});

after(async () => {
  if (!RUN) return;
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  if (!RUN) return;
  await Promise.all([Lead.deleteMany({}), Activity.deleteMany({}), StageHistory.deleteMany({})]);
});

const maybeTest = RUN ? test : test.skip;

maybeTest('intakeLead: a brand-new phone number creates exactly one lead, "new" stage, a system activity and a stage-history row', async () => {
  const { lead, created } = await leadService.intakeLead({ phone: '01012345678', channel: 'phone', name: 'Ahmed Samir' });
  assert.equal(created, true);
  assert.equal(lead.phoneE164, '+201012345678');
  assert.equal(lead.stage, 'new');
  assert.match(lead.refCode, /^RSV-\d{4}-\d{4}$/);
  assert.ok(lead.replyDueAt);

  const activities = await Activity.find({ lead: lead._id }).lean();
  assert.equal(activities.length, 1);
  assert.equal(activities[0].type, 'system');

  const history = await StageHistory.find({ lead: lead._id }).lean();
  assert.equal(history.length, 1);
  assert.equal(history[0].to, 'new');
});

maybeTest('intakeLead: a repeat enquiry on the SAME phone number (different formatting) merges into the existing lead, never creates a second one', async () => {
  const first = await leadService.intakeLead({ phone: '01012345678', channel: 'phone' });
  const second = await leadService.intakeLead({ phone: '00201012345678', channel: 'whatsapp' });

  assert.equal(second.created, false);
  assert.equal(String(second.lead._id), String(first.lead._id));
  assert.equal(await Lead.countDocuments({ phoneE164: '+201012345678' }), 1);

  const activities = await Activity.find({ lead: first.lead._id }).sort({ createdAt: 1 }).lean();
  assert.equal(activities.length, 2);
  assert.match(activities[1].body, /Repeat enquiry via whatsapp/);
});

maybeTest('intakeLead: two concurrent requests for the same brand-new number never create two leads (the unique-index race is handled, not just the pre-check)', async () => {
  const phone = '01098765432';
  const [a, b] = await Promise.all([
    leadService.intakeLead({ phone, channel: 'phone' }),
    leadService.intakeLead({ phone, channel: 'whatsapp' }),
  ]);
  assert.equal(await Lead.countDocuments({ phoneE164: '+201098765432' }), 1);
  assert.equal(String(a.lead._id), String(b.lead._id));
  // Exactly one of the two calls is the creator; the other observed it as a merge.
  assert.equal([a.created, b.created].filter(Boolean).length, 1);
});

maybeTest('recordActivity: an inbound WhatsApp message never counts as the first human reply; an outbound one does', async () => {
  const { lead } = await leadService.intakeLead({ phone: '01111111111', channel: 'whatsapp' });
  await leadService.recordActivity(lead._id, { type: 'whatsapp_in', body: 'Hi, how much for a 5kWp system?' });
  let fresh = await Lead.findById(lead._id).lean();
  assert.equal(fresh.firstReplyAt, null);

  await leadService.recordActivity(lead._id, { type: 'whatsapp_out', body: 'Hello! Sending you our price list now.' });
  fresh = await Lead.findById(lead._id).lean();
  assert.ok(fresh.firstReplyAt);
});

maybeTest('recordActivity: the same WhatsApp message id delivered twice (Meta retry) is only ever recorded once', async () => {
  const { lead } = await leadService.intakeLead({ phone: '01122233344', channel: 'whatsapp' });
  await leadService.recordActivity(lead._id, { type: 'whatsapp_in', body: 'Hello', whatsappMessageId: 'wamid.ABC123' });
  await leadService.recordActivity(lead._id, { type: 'whatsapp_in', body: 'Hello', whatsappMessageId: 'wamid.ABC123' });
  const count = await Activity.countDocuments({ whatsappMessageId: 'wamid.ABC123' });
  assert.equal(count, 1);
});

maybeTest('changeStage: a lead can only move back one stage at a time', async () => {
  const { lead } = await leadService.intakeLead({ phone: '01233445566', channel: 'phone' });
  await leadService.changeStage(lead._id, { to: 'contacted', followUpAt: null }, { role: 'sales' });
  await leadService.changeStage(lead._id, { to: 'qualified', followUpAt: new Date() }, { role: 'sales' });
  await leadService.changeStage(lead._id, { to: 'site_survey', followUpAt: new Date() }, { role: 'sales' });

  await assert.rejects(
    () => leadService.changeStage(lead._id, { to: 'new' }, { role: 'sales' }),
    err => /one stage at a time/.test(err.message)
  );
});

maybeTest('changeStage: Won above EGP 1M requires MD approval - rejected for a sales rep, accepted for the MD role', async () => {
  const { lead } = await leadService.intakeLead({ phone: '01244455566', channel: 'phone' });
  await leadService.changeStage(lead._id, { to: 'contacted', followUpAt: null }, { role: 'sales' });
  await leadService.changeStage(lead._id, { to: 'qualified', followUpAt: new Date() }, { role: 'sales' });
  await leadService.changeStage(lead._id, { to: 'site_survey', followUpAt: new Date() }, { role: 'sales' });
  await leadService.changeStage(lead._id, { to: 'proposal_sent', followUpAt: new Date() }, { role: 'sales' });

  await assert.rejects(
    () => leadService.changeStage(lead._id, { to: 'won', valueEgp: 1_500_000 }, { role: 'sales' }),
    err => /MD approval/.test(err.message)
  );

  const won = await leadService.changeStage(lead._id, { to: 'won', valueEgp: 1_500_000 }, { role: 'md' });
  assert.equal(won.stage, 'won');
  assert.equal(won.mdApproved, true);

  const history = await StageHistory.findOne({ lead: lead._id, to: 'won' }).lean();
  assert.equal(history.valueEgpAtChange, 1_500_000);
});

maybeTest('changeStage: a lost lead can only be reopened by Admin or the MD', async () => {
  const { lead } = await leadService.intakeLead({ phone: '01255566677', channel: 'phone' });
  await leadService.changeStage(lead._id, { to: 'lost', lostReason: 'Price' }, { role: 'sales' });

  await assert.rejects(
    () => leadService.changeStage(lead._id, { to: 'contacted' }, { role: 'sales' }),
    err => /Only Admin or the MD/.test(err.message)
  );

  const reopened = await leadService.changeStage(lead._id, { to: 'contacted' }, { role: 'admin' });
  assert.equal(reopened.stage, 'contacted');
});
