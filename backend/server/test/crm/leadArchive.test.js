const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Acceptance report finding 7: "Add a delete or archive action for the MD only... Prefer soft
// deletion or archiving over permanent deletion... Support restoring archived records." Needs a
// replica set (intakeLead runs in a transaction) - see leadService.test.js's own header comment.

const DB_URI = process.env.TEST_DB_URI;
const RUN = !!DB_URI;

let Lead, Activity, leadService;

before(async () => {
  if (!RUN) return;
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  require('../../models/userModel');
  Lead = require('../../models/crm/leadModel');
  Activity = require('../../models/crm/activityModel');
  leadService = require('../../services/crm/leadService');
  await Lead.init();
});

after(async () => {
  if (!RUN) return;
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  if (!RUN) return;
  await Promise.all([Lead.deleteMany({}), Activity.deleteMany({})]);
});

const maybeTest = RUN ? test : test.skip;

maybeTest('setLeadArchived: archives without deleting the document, records who/when, and is fully reversible', async () => {
  const { lead } = await leadService.intakeLead({ phone: '01022223333', channel: 'phone', name: 'Test Record' }, {});
  const mdId = new mongoose.Types.ObjectId();

  const archived = await leadService.setLeadArchived(lead._id, true, { userId: mdId });
  assert.equal(archived.archived, true);
  assert.ok(archived.archivedAt);
  assert.equal(String(archived.archivedBy), String(mdId));
  assert.equal(await Lead.countDocuments({}), 1, 'the document still exists - this is a soft delete');

  const activities = await Activity.find({ lead: lead._id }).lean();
  assert.ok(activities.some(a => /archived/i.test(a.body)));

  const restored = await leadService.setLeadArchived(lead._id, false, { userId: mdId });
  assert.equal(restored.archived, false);
  assert.equal(restored.archivedAt, null);
  assert.equal(restored.archivedBy, null);
  const restoredActivities = await Activity.find({ lead: lead._id }).lean();
  assert.ok(restoredActivities.some(a => /restored/i.test(a.body)));
});

maybeTest('setLeadArchived: a non-existent lead id is a clean 404, never a crash', async () => {
  await assert.rejects(
    () => leadService.setLeadArchived(new mongoose.Types.ObjectId(), true, {}),
    err => err.statusCode === 404
  );
});
