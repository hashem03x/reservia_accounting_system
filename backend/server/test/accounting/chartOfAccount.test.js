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
