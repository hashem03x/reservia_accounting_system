const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const DB_URI = process.env.TEST_DB_URI;
const RUN = !!DB_URI;
const maybeTest = RUN ? test : test.skip;

let CrmTarget, CrmAdSpend, targetService, adSpendService;

before(async () => {
  if (!RUN) return;
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  CrmTarget = require('../../models/crm/targetModel');
  CrmAdSpend = require('../../models/crm/adSpendModel');
  await Promise.all([CrmTarget.init(), CrmAdSpend.init()]);
  targetService = require('../../services/crm/targetService');
  adSpendService = require('../../services/crm/adSpendService');
});

after(async () => {
  if (!RUN) return;
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  if (!RUN) return;
  await Promise.all([CrmTarget.deleteMany({}), CrmAdSpend.deleteMany({})]);
});

// Change Request 1, Feature 5A: targets are keyed by (segment, month), not (owner, month) - 'all'
// is itself a selectable segment, the single company-wide target entered when a month isn't
// broken down per segment (matches the client's own "All segments: Enquiries 24..." seed data).

maybeTest('setTarget: creates on first call, and revising it later updates the SAME document rather than creating a second one', async () => {
  const first = await targetService.setTarget('all', 2026, 1, { targetSigned: 3, targetValueEgp: 500000 }, { userId: new mongoose.Types.ObjectId() });
  assert.equal(first.targetSigned, 3);
  assert.equal(await CrmTarget.countDocuments({}), 1);

  const revised = await targetService.setTarget('all', 2026, 1, { targetSigned: 5, targetValueEgp: 500000 }, {});
  assert.equal(revised.targetSigned, 5, 'the correction took effect');
  assert.equal(String(revised._id), String(first._id), 'same document, not a duplicate');
  assert.equal(await CrmTarget.countDocuments({}), 1, 'still exactly one target for this segment/month');
});

maybeTest('setTarget: a specific segment target is a SEPARATE record from the "all segments" one, never merged or summed together', async () => {
  await targetService.setTarget('all', 2026, 1, { targetSigned: 10 }, {});
  await targetService.setTarget('farm', 2026, 1, { targetSigned: 2 }, {});
  assert.equal(await CrmTarget.countDocuments({ year: 2026, month: 1 }), 2);

  const all = await CrmTarget.findOne({ segment: 'all', year: 2026, month: 1 }).lean();
  const farm = await CrmTarget.findOne({ segment: 'farm', year: 2026, month: 1 }).lean();
  assert.equal(all.targetSigned, 10);
  assert.equal(farm.targetSigned, 2);
});

maybeTest('setTarget: rejects a segment outside the fixed TARGET_SEGMENTS list', async () => {
  await assert.rejects(() => targetService.setTarget('not-a-real-segment', 2026, 1, { targetSigned: 1 }, {}));
});

maybeTest('listTargets: scoped to the requested year/month, optionally one segment', async () => {
  await targetService.setTarget('all', 2026, 1, { targetSigned: 3 }, {});
  await targetService.setTarget('villa', 2026, 1, { targetSigned: 2 }, {});
  await targetService.setTarget('all', 2026, 2, { targetSigned: 7 }, {}); // different month

  const jan = await targetService.listTargets(2026, 1);
  assert.equal(jan.length, 2);

  const janAllOnly = await targetService.listTargets(2026, 1, { segment: 'all' });
  assert.equal(janAllOnly.length, 1);
  assert.equal(janAllOnly[0].targetSigned, 3);
});

maybeTest('setAdSpend: upserts per (channel, year, month) - a second entry for the same month corrects, never duplicates', async () => {
  await adSpendService.setAdSpend('Farms', 2026, 11, 5000, { segment: 'farm' });
  await adSpendService.setAdSpend('Farms', 2026, 11, 7000, { segment: 'farm' });
  assert.equal(await CrmAdSpend.countDocuments({}), 1);

  const rows = await adSpendService.listAdSpend(2026, 11);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amountEgp, 7000);
});

maybeTest('setAdSpend: distinct channel names in the same month are separate line items, even when tagged with the same segment', async () => {
  await adSpendService.setAdSpend('Farm test', 2026, 11, 7000, { segment: 'farm' });
  await adSpendService.setAdSpend('Farms', 2026, 11, 14500, { segment: 'farm' });
  const rows = await adSpendService.listAdSpend(2026, 11);
  assert.equal(rows.length, 2);
  assert.equal(rows.reduce((sum, r) => sum + r.amountEgp, 0), 21500);
});

maybeTest('setAdSpend: a channel with no segment (SEO, agency fees) is stored with segment: null, never forced onto a segment', async () => {
  const row = await adSpendService.setAdSpend('SEO', 2026, 11, 3000, {});
  assert.equal(row.segment, null);
});

maybeTest('setAdSpend: rejects a segment outside FORM_SEGMENTS (defense in depth - the validator should already have caught this)', async () => {
  await assert.rejects(() => adSpendService.setAdSpend('Bad channel', 2026, 11, 100, { segment: 'not-a-real-segment' }));
});
