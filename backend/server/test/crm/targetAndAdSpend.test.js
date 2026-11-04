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

const OWNER = new mongoose.Types.ObjectId();

maybeTest('setTarget: creates on first call, and revising it later updates the SAME document rather than creating a second one', async () => {
  const first = await targetService.setTarget(OWNER, 2026, 1, { targetSigned: 3, targetValueEgp: 500000 }, { userId: OWNER });
  assert.equal(first.targetSigned, 3);
  assert.equal(await CrmTarget.countDocuments({}), 1);

  const revised = await targetService.setTarget(OWNER, 2026, 1, { targetSigned: 5, targetValueEgp: 500000 }, { userId: OWNER });
  assert.equal(revised.targetSigned, 5, 'the correction took effect');
  assert.equal(String(revised._id), String(first._id), 'same document, not a duplicate');
  assert.equal(await CrmTarget.countDocuments({}), 1, 'still exactly one target for this owner/month');
});

maybeTest('listTargets: scoped to the requested year/month, optionally one owner', async () => {
  const otherOwner = new mongoose.Types.ObjectId();
  await targetService.setTarget(OWNER, 2026, 1, { targetSigned: 3 }, {});
  await targetService.setTarget(otherOwner, 2026, 1, { targetSigned: 2 }, {});
  await targetService.setTarget(OWNER, 2026, 2, { targetSigned: 7 }, {}); // different month

  const jan = await targetService.listTargets(2026, 1);
  assert.equal(jan.length, 2);

  const janOwnerOnly = await targetService.listTargets(2026, 1, { ownerId: OWNER });
  assert.equal(janOwnerOnly.length, 1);
  assert.equal(janOwnerOnly[0].targetSigned, 3);
});

maybeTest('setAdSpend: upserts per (source, year, month) - a second entry for the same month corrects, never duplicates', async () => {
  await adSpendService.setAdSpend('Google Ads', 2026, 1, 5000, {});
  await adSpendService.setAdSpend('Google Ads', 2026, 1, 7000, {});
  assert.equal(await CrmAdSpend.countDocuments({}), 1);

  const rows = await adSpendService.listAdSpend(2026, 1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amountEgp, 7000);
});
