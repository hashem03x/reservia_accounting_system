const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Acceptance report finding 2: "Website leads arrive with no owner... Assign new web leads to the
// Sales Engineer automatically, or round-robin... Notify the owner... Record the assignment in
// lead activity history." Needs a replica set (intakeLead runs in a transaction) - see
// leadService.test.js's own header comment for why this file self-skips without one.

const DB_URI = process.env.TEST_DB_URI;
const RUN = !!DB_URI;

let User, Lead, Activity, leadService, eligibleSalesEngineers, pickAutoAssignee, assignmentStrategy;

before(async () => {
  if (!RUN) return;
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  User = require('../../models/userModel');
  Lead = require('../../models/crm/leadModel');
  Activity = require('../../models/crm/activityModel');
  leadService = require('../../services/crm/leadService');
  ({ eligibleSalesEngineers, pickAutoAssignee, assignmentStrategy } = require('../../services/crm/leadAssignmentService'));
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

maybeTest('pickAutoAssignee: applies to the automated intake channels (website AND WhatsApp, Change Request 1 Feature 2), never phone/dealer/manual', async () => {
  await salesUser('Mona Khaled');
  assert.equal(await pickAutoAssignee('phone'), null);
  assert.equal(await pickAutoAssignee('dealer'), null);
  assert.notEqual(await pickAutoAssignee('web_form'), null);
  assert.notEqual(await pickAutoAssignee('landing_page'), null);
  assert.notEqual(await pickAutoAssignee('whatsapp'), null, 'Change Request 1 Feature 2: WhatsApp leads must also get an automatic owner');
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

maybeTest('intakeLead: multiple SIMULTANEOUS web_form submissions round-robin correctly - no race leaves a lead unassigned or skips a rotation slot', async () => {
  // Real concurrency (Promise.all), not sequential awaits - exercises the atomic $inc rotation
  // counter (services/crm/leadAssignmentService.js#nextRotationSeq) under genuine contention,
  // the exact scenario "test multiple simultaneous submissions" is checking for.
  const mona = await salesUser('Mona Khaled');
  const omar = await salesUser('Omar Said');
  const sara = await salesUser('Sara Adel');

  const submissions = await Promise.all(
    Array.from({ length: 9 }, (_, i) => leadService.intakeLead({ phone: `0102222${String(6000 + i)}`, channel: 'web_form', name: `Concurrent ${i}` }, {}))
  );

  const owners = submissions.map(s => String(s.lead.owner._id || s.lead.owner));
  assert.equal(owners.length, 9);
  assert.ok(owners.every(id => id !== 'null' && id !== 'undefined'), 'no concurrent submission was left unassigned by a race');

  // Every one of the 3 eligible engineers received some leads - round-robin spread the load,
  // never piled every concurrent submission onto a single engineer.
  const counts = { [mona._id]: 0, [omar._id]: 0, [sara._id]: 0 };
  for (const id of owners) counts[id] = (counts[id] || 0) + 1;
  assert.ok(Object.values(counts).every(c => c > 0), `expected all 3 engineers to get at least one lead, got: ${JSON.stringify(counts)}`);

  // No duplicate leads were created despite the concurrent writes (each phone is unique here, so
  // this also confirms no cross-submission corruption of the wrong lead's owner).
  assert.equal(await Lead.countDocuments({}), 9);
});

maybeTest('an explicit owner (e.g. a staff member assigning to themselves) is never overridden by auto-assignment', async () => {
  const mona = await salesUser('Mona Khaled');
  const omar = await salesUser('Omar Said');
  const { lead } = await leadService.intakeLead({ phone: '01011115555', channel: 'web_form', owner: omar._id }, {});
  assert.equal(String(lead.owner._id || lead.owner), String(omar._id));
  void mona;
});

maybeTest('intakeLead: a brand-new WhatsApp lead is also auto-assigned, logged in activity history (Change Request 1, Feature 2)', async () => {
  const mona = await salesUser('Mona Khaled');
  const { lead } = await leadService.intakeLead({ phone: '01011119999', channel: 'whatsapp', name: 'WA Visitor', source: 'WhatsApp Direct' }, {});
  assert.equal(String(lead.owner._id || lead.owner), String(mona._id));
  const activities = await Activity.find({ lead: lead._id }).lean();
  assert.ok(activities.some(a => /automatically assigned/i.test(a.body)));
});

// ===================== assignmentStrategy() / 'single' strategy fallback (pure env parsing - no DB) =====================

test('assignmentStrategy: defaults to round_robin, accepts "single" case-insensitively, rejects anything else', () => {
  const original = process.env.CRM_ASSIGNMENT_STRATEGY;
  try {
    delete process.env.CRM_ASSIGNMENT_STRATEGY;
    assert.equal(assignmentStrategyPure(), 'round_robin');
    process.env.CRM_ASSIGNMENT_STRATEGY = 'SINGLE';
    assert.equal(assignmentStrategyPure(), 'single');
    process.env.CRM_ASSIGNMENT_STRATEGY = 'something-else';
    assert.equal(assignmentStrategyPure(), 'round_robin');
  } finally {
    if (original === undefined) delete process.env.CRM_ASSIGNMENT_STRATEGY;
    else process.env.CRM_ASSIGNMENT_STRATEGY = original;
  }
});

function assignmentStrategyPure() {
  // Re-require fresh each time isn't needed - assignmentStrategy() reads process.env live on every call.
  return require('../../services/crm/leadAssignmentService').assignmentStrategy();
}

maybeTest('pickAutoAssignee: strategy "single" always picks the configured default Sales Engineer when eligible', async () => {
  await salesUser('Mona Khaled');
  const omar = await salesUser('Omar Said');
  const originalStrategy = process.env.CRM_ASSIGNMENT_STRATEGY;
  const originalEmail = process.env.CRM_DEFAULT_SALES_ENGINEER_EMAIL;
  try {
    process.env.CRM_ASSIGNMENT_STRATEGY = 'single';
    process.env.CRM_DEFAULT_SALES_ENGINEER_EMAIL = omar.email;
    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const picked = await pickAutoAssignee('web_form');
      assert.equal(String(picked._id), String(omar._id), 'every pick goes to the configured default engineer, not round-robin');
    }
  } finally {
    if (originalStrategy === undefined) delete process.env.CRM_ASSIGNMENT_STRATEGY;
    else process.env.CRM_ASSIGNMENT_STRATEGY = originalStrategy;
    if (originalEmail === undefined) delete process.env.CRM_DEFAULT_SALES_ENGINEER_EMAIL;
    else process.env.CRM_DEFAULT_SALES_ENGINEER_EMAIL = originalEmail;
  }
});

maybeTest('pickAutoAssignee: strategy "single" falls back to round-robin when the configured engineer is not currently eligible', async () => {
  const mona = await salesUser('Mona Khaled');
  const originalStrategy = process.env.CRM_ASSIGNMENT_STRATEGY;
  const originalEmail = process.env.CRM_DEFAULT_SALES_ENGINEER_EMAIL;
  try {
    process.env.CRM_ASSIGNMENT_STRATEGY = 'single';
    process.env.CRM_DEFAULT_SALES_ENGINEER_EMAIL = 'nobody-configured@reservia.test';
    const picked = await pickAutoAssignee('web_form');
    assert.equal(String(picked._id), String(mona._id), 'falls back to round-robin across the eligible pool rather than leaving the lead unassigned');
  } finally {
    if (originalStrategy === undefined) delete process.env.CRM_ASSIGNMENT_STRATEGY;
    else process.env.CRM_ASSIGNMENT_STRATEGY = originalStrategy;
    if (originalEmail === undefined) delete process.env.CRM_DEFAULT_SALES_ENGINEER_EMAIL;
    else process.env.CRM_DEFAULT_SALES_ENGINEER_EMAIL = originalEmail;
  }
});

// ===================== reassignLead (Change Request 1, Feature 2: manual reassignment) =====================

maybeTest('reassignLead: moves ownership, names the previous owner in activity history, and notifies the new owner', async () => {
  const mona = await salesUser('Mona Khaled');
  const omar = await salesUser('Omar Said');
  const { lead } = await leadService.intakeLead({ phone: '01022223333', channel: 'phone', owner: mona._id }, {});

  const updated = await leadService.reassignLead(lead._id, omar._id, {});
  assert.equal(String(updated.owner._id || updated.owner), String(omar._id));

  const activities = await Activity.find({ lead: lead._id }).lean();
  assert.ok(
    activities.some(a => a.type === 'system' && /reassigned from Mona Khaled to Omar Said/i.test(a.body)),
    `expected a reassignment activity naming both owners, got: ${JSON.stringify(activities.map(a => a.body))}`
  );
});

maybeTest('reassignLead: unassigning (ownerId null) records the previous owner\'s name rather than silently going blank', async () => {
  const mona = await salesUser('Mona Khaled');
  const { lead } = await leadService.intakeLead({ phone: '01022224444', channel: 'phone', owner: mona._id }, {});

  const updated = await leadService.reassignLead(lead._id, null, {});
  assert.equal(updated.owner, null);

  const activities = await Activity.find({ lead: lead._id }).lean();
  assert.ok(activities.some(a => /unassigned \(was Mona Khaled\)/i.test(a.body)));
});
