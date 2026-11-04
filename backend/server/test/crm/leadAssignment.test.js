const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Acceptance report finding 2: "Website leads arrive with no owner... Assign new web leads to the
// Sales Engineer automatically, or round-robin... Notify the owner... Record the assignment in
// lead activity history." Needs a replica set (intakeLead runs in a transaction) - see
// leadService.test.js's own header comment for why this file self-skips without one.

const DB_URI = process.env.TEST_DB_URI;
const RUN = !!DB_URI;

let User, Lead, Activity, leadService, eligibleSalesEngineers, pickAutoAssignee;

before(async () => {
  if (!RUN) return;
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  User = require('../../models/userModel');
  Lead = require('../../models/crm/leadModel');
  Activity = require('../../models/crm/activityModel');
  leadService = require('../../services/crm/leadService');
  ({ eligibleSalesEngineers, pickAutoAssignee } = require('../../services/crm/leadAssignmentService'));
  await Lead.init();
  await Activity.init();
});

after(async () => {
  if (!RUN) return;
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  if (!RUN) return;
  await Promise.all([Lead.deleteMany({}), Activity.deleteMany({}), User.deleteMany({}), mongoose.connection.collection('counters').deleteMany({})]);
});

const maybeTest = RUN ? test : test.skip;

function salesUser(name, overrides = {}) {
  return User.create({
    name,
    email: `${name.toLowerCase().replace(/\s+/g, '.')}@reservia.test`,
    password: 'x',
    role: 'operator',
    type: 'online',
    systemMemberships: [{ system: 'CRM', role: 'sales', isActive: true }],
    ...overrides,
  });
}

maybeTest('eligibleSalesEngineers: only active users with an active CRM sales membership', async () => {
  const active = await salesUser('Mona Khaled');
  await salesUser('Inactive Membership', { systemMemberships: [{ system: 'CRM', role: 'sales', isActive: false }] });
  await salesUser('Not Sales', { systemMemberships: [{ system: 'CRM', role: 'technical', isActive: true }] });
  await salesUser('Deactivated Account', { isActive: false });
  const pool = await eligibleSalesEngineers();
  assert.equal(pool.length, 1);
  assert.equal(String(pool[0]._id), String(active._id));
});

maybeTest('pickAutoAssignee: only applies to the automated website intake channels, never phone/whatsapp/manual', async () => {
  await salesUser('Mona Khaled');
  assert.equal(await pickAutoAssignee('phone'), null);
  assert.equal(await pickAutoAssignee('whatsapp'), null);
  assert.equal(await pickAutoAssignee('dealer'), null);
  assert.notEqual(await pickAutoAssignee('web_form'), null);
  assert.notEqual(await pickAutoAssignee('landing_page'), null);
});

maybeTest('pickAutoAssignee: with nobody eligible, returns null rather than throwing - "handle assignment failures gracefully"', async () => {
  assert.equal(await pickAutoAssignee('web_form'), null);
});

maybeTest('intakeLead: a web_form lead with no owner is auto-assigned, logged in activity history, and the SLA clock still starts', async () => {
  const mona = await salesUser('Mona Khaled');
  const { lead } = await leadService.intakeLead({ phone: '01011112222', channel: 'web_form', name: 'Website Visitor' }, {});
  assert.equal(String(lead.owner._id || lead.owner), String(mona._id));
  assert.ok(lead.replyDueAt, 'the first-reply SLA clock is set regardless of assignment');
  const activities = await Activity.find({ lead: lead._id }).lean();
  assert.ok(activities.some(a => /automatically assigned/i.test(a.body)), 'the assignment is recorded in activity history');
});

maybeTest('intakeLead: a manually-created lead (staff "New Lead" form) is never auto-assigned - a human already chose to leave it unowned', async () => {
  await salesUser('Mona Khaled');
  const { lead } = await leadService.intakeLead({ phone: '01011113333', channel: 'phone', name: 'Walk-in' }, {});
  assert.equal(lead.owner, null);
});

maybeTest('intakeLead: round-robins across the eligible pool rather than always picking the same person', async () => {
  const mona = await salesUser('Mona Khaled');
  const omar = await salesUser('Omar Said');
  const owners = [];
  for (let i = 0; i < 4; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const { lead } = await leadService.intakeLead({ phone: `0101111${4000 + i}`, channel: 'web_form' }, {});
    owners.push(String(lead.owner._id || lead.owner));
  }
  assert.ok(owners.includes(String(mona._id)) && owners.includes(String(omar._id)), 'both sales engineers received at least one lead');
});

maybeTest('an explicit owner (e.g. a staff member assigning to themselves) is never overridden by auto-assignment', async () => {
  const mona = await salesUser('Mona Khaled');
  const omar = await salesUser('Omar Said');
  const { lead } = await leadService.intakeLead({ phone: '01011115555', channel: 'web_form', owner: omar._id }, {});
  assert.equal(String(lead.owner._id || lead.owner), String(omar._id));
  void mona;
});
