const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// Regression test for a real bug caught during the CRM acceptance audit: userModel.js's own
// password pre-save hook called `bcrypt.hash(this.password, 5)` without `await`, so `this.password`
// was assigned the pending Promise object, never the actual hash. Every real controller already
// pre-hashes the password itself before calling User.create()/save(), which is what masked this in
// practice - but a direct `User.create({ password: 'plaintext' })`, exactly what the hook's own
// existence implies should be safe, stored the password completely unhashed.

const DB_URI = process.env.TEST_DB_URI;
const RUN = !!DB_URI;
const maybeTest = RUN ? test : test.skip;

let User;

before(async () => {
  if (!RUN) return;
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  User = require('../models/userModel');
  await User.init();
});

after(async () => {
  if (!RUN) return;
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  if (!RUN) return;
  await User.deleteMany({});
});

maybeTest("the model's own pre-save hook actually bcrypt-hashes a plaintext password, never stores it as-is", async () => {
  const user = await User.create({ name: 'Hash Test', email: 'hash-test@example.com', password: 'PlaintextPass123!', type: 'online' });

  const stored = await User.findById(user._id).select('+password').lean();
  assert.notEqual(stored.password, 'PlaintextPass123!', 'the raw plaintext must never be what is stored');
  assert.ok(/^\$2[aby]\$/.test(stored.password), `expected a real bcrypt hash, got: ${JSON.stringify(stored.password)}`);
  assert.equal(await bcrypt.compare('PlaintextPass123!', stored.password), true, 'the stored hash must actually verify the original password');
});

maybeTest('changing an existing user\'s password re-hashes the new value, not the old one', async () => {
  const user = await User.create({ name: 'Hash Test 2', email: 'hash-test-2@example.com', password: 'FirstPass123!', type: 'online' });
  user.password = 'SecondPass456!';
  await user.save();

  const stored = await User.findById(user._id).select('+password').lean();
  assert.equal(await bcrypt.compare('SecondPass456!', stored.password), true);
  assert.equal(await bcrypt.compare('FirstPass123!', stored.password), false);
});
