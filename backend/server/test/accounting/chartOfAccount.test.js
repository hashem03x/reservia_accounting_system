const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_chart_of_accounts';

let ChartOfAccount;

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
  // Explicitly wait for index builds (unique `code`) to finish - autoIndex builds run in the
  // background and are not implicitly awaited by create()/save(), so a test asserting a unique
  // constraint immediately after connecting can otherwise race the index build under load (e.g.
  // several test files' Mongo connections contending for the same local mongod).
  await ChartOfAccount.init();
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  await ChartOfAccount.deleteMany({});
});

test('creates an account with a valid type', async () => {
  const account = await ChartOfAccount.create({ code: '1000', name: 'Cash', type: 'asset' });
  assert.equal(account.code, '1000');
  assert.equal(account.isActive, true);
});

test('rejects an invalid account type at the schema level', async () => {
  await assert.rejects(() => ChartOfAccount.create({ code: '1001', name: 'Bad Type', type: 'not-a-real-type' }), /not a valid account type/);
});

test('rejects a duplicate account code via the unique index', async () => {
  await ChartOfAccount.create({ code: '1100', name: 'Accounts Receivable', type: 'asset' });
  await assert.rejects(() => ChartOfAccount.create({ code: '1100', name: 'Duplicate', type: 'asset' }), err => err.code === 11000);
});

test('retrieves an account by id with its parent populated', async () => {
  const parent = await ChartOfAccount.create({ code: '1000', name: 'Assets', type: 'asset' });
  const child = await ChartOfAccount.create({ code: '1100', name: 'Current Assets', type: 'asset', parentAccount: parent._id });

  const found = await ChartOfAccount.findById(child._id);
  assert.equal(found.parentAccount.code, '1000');
});

test('updates an account', async () => {
  const account = await ChartOfAccount.create({ code: '2000', name: 'Payables', type: 'liability' });
  account.name = 'Accounts Payable';
  await account.save();

  const found = await ChartOfAccount.findById(account._id);
  assert.equal(found.name, 'Accounts Payable');
});

test('an account cannot be set as its own parent', async () => {
  const account = await ChartOfAccount.create({ code: '3000', name: 'Equity', type: 'equity' });
  account.parentAccount = account._id;
  await assert.rejects(() => account.save(), /own parent/);
});

test('an account can be created with a valid state and defaults to null', async () => {
  const withState = await ChartOfAccount.create({ code: '4000', name: 'Cash', type: 'asset', state: 'current' });
  assert.equal(withState.state, 'current');

  const withoutState = await ChartOfAccount.create({ code: '4001', name: 'Land', type: 'asset' });
  assert.equal(withoutState.state, null);
});

test('rejects an invalid state at the schema level', async () => {
  await assert.rejects(() => ChartOfAccount.create({ code: '4002', name: 'Bad State', type: 'asset', state: 'not-a-real-state' }), /not a valid account state/);
});

test('accepts the cogs account type', async () => {
  const account = await ChartOfAccount.create({ code: '5000', name: 'Direct Materials', type: 'cogs' });
  assert.equal(account.type, 'cogs');
});

const { getNextSortOrder, typeBase } = require('../../services/accounting/chartOfAccountOrderingService');

test('getNextSortOrder places a new top-level account after the last one of the same type', async () => {
  await ChartOfAccount.create({ code: 'A1', name: 'Asset One', type: 'asset', sortOrder: typeBase('asset') + 1 });
  await ChartOfAccount.create({ code: 'A2', name: 'Asset Two', type: 'asset', sortOrder: typeBase('asset') + 2 });

  const next = await getNextSortOrder({ type: 'asset' });
  assert.equal(next, typeBase('asset') + 3);
});

test('getNextSortOrder keeps a different type in its own block, unaffected by another type\'s accounts', async () => {
  await ChartOfAccount.create({ code: 'E1', name: 'Expense One', type: 'expense', sortOrder: typeBase('expense') + 1 });

  const nextAsset = await getNextSortOrder({ type: 'asset' });
  assert.equal(nextAsset, typeBase('asset') + 1, 'a type with no existing accounts yet must start at the bottom of its own block, not be pushed by another type');
});

test('getNextSortOrder places a new child after existing children of the same parent', async () => {
  const parent = await ChartOfAccount.create({ code: 'P1', name: 'Parent', type: 'liability', sortOrder: typeBase('liability') + 1 });
  const firstChild = await getNextSortOrder({ type: 'liability', parentAccount: parent._id });
  await ChartOfAccount.create({ code: 'C1', name: 'Child One', type: 'liability', parentAccount: parent._id, sortOrder: firstChild });

  const secondChild = await getNextSortOrder({ type: 'liability', parentAccount: parent._id });
  assert.ok(secondChild > firstChild, 'the second child must sort after the first child');
});
