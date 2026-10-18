const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Central Business Portal migration (scripts/backfillErpSystemMemberships.js) - exercised
// directly via its exported function with `connect:false` (reuses this test's own DB connection),
// the same technique test/project/sectors.test.js uses for scripts/seedSectors.js.

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_portal_migration';

let User;
let backfillErpSystemMemberships;

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  User = require('../../models/userModel');
  ({ backfillErpSystemMemberships } = require('../../scripts/backfillErpSystemMemberships'));
  await User.init();
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  await User.deleteMany({});
});

let seq = 0;
async function makeUser(overrides = {}) {
  seq += 1;
  return User.create({ name: `User ${seq}`, email: `migration-user${seq}@example.com`, role: 'user', password: 'x', ...overrides });
}

test('backfills an ERP membership for every existing staff account (admin/moderator/operator), mirroring their existing role', async () => {
  const admin = await makeUser({ role: 'admin' });
  const moderator = await makeUser({ role: 'moderator' });
  const operator = await makeUser({ role: 'operator' });
  const customer = await makeUser({ role: 'user' });

  const result = await backfillErpSystemMemberships({ connect: false });
  assert.equal(result.found, 3);

  const reloadedAdmin = await User.findById(admin._id);
  const reloadedModerator = await User.findById(moderator._id);
  const reloadedOperator = await User.findById(operator._id);
  const reloadedCustomer = await User.findById(customer._id);

  assert.deepEqual(reloadedAdmin.systemMemberships.map(m => ({ system: m.system, role: m.role, isActive: m.isActive })), [{ system: 'ERP', role: 'admin', isActive: true }]);
  assert.equal(reloadedModerator.systemMemberships[0].role, 'moderator');
  assert.equal(reloadedOperator.systemMemberships[0].role, 'operator');
  assert.equal(reloadedCustomer.systemMemberships.length, 0, 'a customer (role: user) must never receive an ERP membership');
});

test('is idempotent: running it twice never duplicates the ERP entry', async () => {
  await makeUser({ role: 'admin' });

  const first = await backfillErpSystemMemberships({ connect: false });
  assert.equal(first.found, 1);
  const second = await backfillErpSystemMemberships({ connect: false });
  assert.equal(second.found, 0, 'nothing left to migrate the second time');

  const user = await User.findOne({ role: 'admin' });
  assert.equal(user.systemMemberships.filter(m => m.system === 'ERP').length, 1);
});

test('never touches a staff account that already has an ERP membership entry (even an inactive/custom one)', async () => {
  const alreadyMigrated = await makeUser({ role: 'moderator', systemMemberships: [{ system: 'ERP', role: 'operator', isActive: false }] });

  const result = await backfillErpSystemMemberships({ connect: false });
  assert.equal(result.found, 0);

  const reloaded = await User.findById(alreadyMigrated._id);
  assert.equal(reloaded.systemMemberships[0].role, 'operator', 'the existing (even if unusual) entry must be left exactly as-is');
  assert.equal(reloaded.systemMemberships[0].isActive, false);
});

test('--dry-run reports what would change without writing anything', async () => {
  await makeUser({ role: 'admin' });
  const result = await backfillErpSystemMemberships({ connect: false, dryRun: true });
  assert.equal(result.found, 1);
  assert.equal(result.migrated.length, 0);

  const user = await User.findOne({ role: 'admin' });
  assert.equal(user.systemMemberships.length, 0, 'dry-run must never write');
});
