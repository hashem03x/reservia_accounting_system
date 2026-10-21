const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { validationResult } = require('express-validator');

const {
  buildChildrenIndex,
  selectParentEligible,
  parentAssignmentError,
  getParentEligibleAccounts,
  validateParentAssignment,
} = require('../../services/accounting/chartOfAccountParentService');

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_chart_of_account_parents';

// ---- Pure rule (no database) --------------------------------------------------------------------

const acc = (id, name, extra = {}) => ({ _id: id, code: id, name, isActive: true, ...extra });

test('only accounts shown in another account\'s Parent Account column are parents', () => {
  const accounts = [
    acc('1', 'Assets'),
    acc('11', 'Current Assets', { parentAccount: '1' }),
    acc('111', 'Cash', { parentAccount: { _id: '11', code: '11', name: 'Current Assets' } }), // populated ref
    acc('2', 'Liabilities'),
  ];
  const ids = selectParentEligible(accounts).map(a => a._id);
  // '111' has a parent but is nobody's parent; '2' is top-level with no children.
  assert.deepEqual(ids, ['1', '11']);
});

test('an imported group label designates the account it names as a parent (normalized match)', () => {
  const accounts = [
    acc('100', 'Cash & Cash Equivalents'),
    acc('101', 'NBE', { parentGroupNameEn: 'cash  &  cash equivalents' }),
    acc('200', 'Accumulated Depreciation – Fixed Assets'),
    acc('201', 'AD - Vehicles', { parentGroupNameEn: 'Accumulated Depreciation - Fixed Assets' }),
    acc('300', 'Orphan', { parentGroupNameEn: 'A group with no account of that name' }),
  ];
  assert.deepEqual(selectParentEligible(accounts).map(a => a._id), ['100', '200']);
});

test('a parentAccount reference wins over a group label, exactly like the table column', () => {
  const accounts = [
    acc('1', 'Group A'),
    acc('2', 'Group B'),
    acc('3', 'Child', { parentAccount: '1', parentGroupNameEn: 'Group B' }),
  ];
  assert.deepEqual(selectParentEligible(accounts).map(a => a._id), ['1']);
});

test('a group label repeating the account\'s own name does not make it its own parent', () => {
  const index = buildChildrenIndex([acc('1', 'Self', { parentGroupNameEn: 'Self' })]);
  assert.equal(index.size, 0);
});

test('inactive parents are not offered', () => {
  const accounts = [acc('1', 'Old Group', { isActive: false }), acc('2', 'Child', { parentAccount: '1' })];
  assert.deepEqual(selectParentEligible(accounts), []);
});

test('excludeId removes the edited account and its whole subtree', () => {
  const accounts = [
    acc('1', 'Root'),
    acc('2', 'Mid', { parentAccount: '1' }),
    acc('3', 'Leaf Group', { parentAccount: '2' }),
    acc('4', 'Leaf', { parentAccount: '3' }),
    acc('5', 'Other Root'),
    acc('6', 'Other Child', { parentAccount: '5' }),
  ];
  assert.deepEqual(selectParentEligible(accounts, { excludeId: '2' }).map(a => a._id), ['1', '5']);
});

test('parentAssignmentError rejects non-parents, missing, self and cycles; allows designated and unchanged parents', () => {
  const accounts = [
    acc('1', 'Root'),
    acc('2', 'Mid', { parentAccount: '1' }),
    acc('3', 'Leaf', { parentAccount: '2' }),
    acc('9', 'Plain'),
    acc('8', 'Retired Group', { isActive: false }),
    acc('7', 'Under Retired', { parentAccount: '8' }),
  ];
  assert.equal(parentAssignmentError(accounts, '1'), null);
  assert.match(parentAssignmentError(accounts, '3'), /not designated as a parent/);
  assert.match(parentAssignmentError(accounts, '9'), /not designated as a parent/);
  assert.match(parentAssignmentError(accounts, 'missing'), /does not exist/);
  assert.match(parentAssignmentError(accounts, '2', { accountId: '2' }), /own parent/);
  assert.match(parentAssignmentError(accounts, '2', { accountId: '1' }), /own sub-accounts/);
  assert.match(parentAssignmentError(accounts, '8'), /inactive/);
  // Re-saving the existing parent is always fine, even an inactive one.
  assert.equal(parentAssignmentError(accounts, '8', { accountId: '7' }), null);
  assert.equal(parentAssignmentError(accounts, '2', { accountId: '3' }), null);
});

// ---- Database-backed: service + request validators ----------------------------------------------

let ChartOfAccount;
let createChartOfAccountValidators;
let updateChartOfAccountValidators;

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
  ({ createChartOfAccountValidators, updateChartOfAccountValidators } = require('../../utils/validators/chartOfAccountValidators'));
  await ChartOfAccount.init();
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  await ChartOfAccount.deleteMany({});
});

async function seed() {
  const assets = await ChartOfAccount.create({ code: '1', name: 'Assets', type: 'asset' });
  const current = await ChartOfAccount.create({ code: '11', name: 'Current Assets', type: 'asset', parentAccount: assets._id });
  const cash = await ChartOfAccount.create({ code: '111', name: 'Cash', type: 'asset', parentAccount: current._id });
  const cce = await ChartOfAccount.create({ code: '12', name: 'Cash & Cash Equivalents', type: 'asset' });
  const nbe = await ChartOfAccount.create({ code: '121', name: 'NBE', type: 'asset', parentGroupNameEn: 'Cash & Cash Equivalents' });
  const revenue = await ChartOfAccount.create({ code: '4', name: 'Revenue', type: 'revenue' });
  return { assets, current, cash, cce, nbe, revenue };
}

// Runs a validator chain array (minus its trailing validatorMiddleware) against a fake request.
async function runValidators(validators, { body, params = {} }) {
  const req = { body, params, query: {}, headers: {}, cookies: {} };
  for (const chain of validators.slice(0, -1)) await chain.run(req);
  return validationResult(req)
    .array()
    .filter(e => (e.param ?? e.path) === 'parentAccount') // v6 reports the field as `param`
    .map(e => e.msg);
}

test('getParentEligibleAccounts returns only designated parents, ordered by code', async () => {
  await seed();
  const codes = (await getParentEligibleAccounts()).map(a => a.code);
  assert.deepEqual(codes, ['1', '11', '12']);
});

test('getParentEligibleAccounts with exclude omits the edited account and its descendants', async () => {
  const { current } = await seed();
  const codes = (await getParentEligibleAccounts({ excludeId: current._id })).map(a => a.code);
  assert.deepEqual(codes, ['1', '12']);
});

test('validateParentAssignment reflects the live hierarchy', async () => {
  const { assets, cash, revenue } = await seed();
  assert.equal(await validateParentAssignment(String(assets._id)), null);
  assert.match(await validateParentAssignment(String(cash._id)), /not designated as a parent/);
  assert.match(await validateParentAssignment(String(revenue._id)), /not designated as a parent/);
});

test('create validator accepts a designated parent and rejects an ordinary account', async () => {
  const { current, cash } = await seed();
  const base = { code: '999', name: 'New', type: 'asset' };
  assert.deepEqual(await runValidators(createChartOfAccountValidators, { body: { ...base, parentAccount: String(current._id) } }), []);
  assert.deepEqual(await runValidators(createChartOfAccountValidators, { body: { ...base } }), []);
  assert.deepEqual(await runValidators(createChartOfAccountValidators, { body: { ...base, parentAccount: null } }), []);
  const errors = await runValidators(createChartOfAccountValidators, { body: { ...base, parentAccount: String(cash._id) } });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /not designated as a parent/);
});

test('update validator keeps the existing parent valid and rejects cycles and non-parents', async () => {
  const { assets, current, cash, revenue } = await seed();
  const update = (id, parentAccount) => runValidators(updateChartOfAccountValidators, { body: { parentAccount }, params: { id: String(id) } });

  assert.deepEqual(await update(cash._id, String(current._id)), []); // unchanged
  assert.deepEqual(await update(revenue._id, String(assets._id)), []); // move under a designated parent
  assert.match((await update(assets._id, String(current._id)))[0], /own sub-accounts/);
  assert.match((await update(current._id, String(current._id)))[0], /own parent/);
  assert.match((await update(revenue._id, String(cash._id)))[0], /not designated as a parent/);
});

test('existing accounts and relationships are left untouched by eligibility checks', async () => {
  const { current, cash, nbe } = await seed();
  await getParentEligibleAccounts();
  await validateParentAssignment(String(cash._id), { accountId: String(nbe._id) });
  const reloadedCash = await ChartOfAccount.findById(cash._id);
  const reloadedNbe = await ChartOfAccount.findById(nbe._id);
  assert.equal(String(reloadedCash.parentAccount._id), String(current._id));
  assert.equal(reloadedNbe.parentGroupNameEn, 'Cash & Cash Equivalents');
  assert.equal(reloadedNbe.parentAccount, null);
});
