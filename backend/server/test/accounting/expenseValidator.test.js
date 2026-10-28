const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { validationResult } = require('express-validator');

// Covers the validator-layer enforcement of "a salary expense does not require a vendor" (the
// `expenseType` branch added to createExpenseValidator) - exercised through the SAME validator
// chain the real expense route uses, the same technique test/user/contactInfoValidation.test.js
// and test/vendor/installmentsRequirePaymentTerms.test.js use, rather than a full HTTP+supertest
// layer. No transaction/replica-set needed - express-validator's own checks here only ever do
// plain finds.

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_expense_validator';

let Vendor, ChartOfAccount;

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  Vendor = require('../../models/vendor/vendor');
  ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
  await Promise.all([Vendor.init(), ChartOfAccount.init()]);
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  await Promise.all([Vendor.deleteMany({}), ChartOfAccount.deleteMany({})]);
});

async function runValidators(validators, body, params = {}) {
  const req = { body, params, query: {} };
  for (const middleware of validators) {
    if (typeof middleware.run === 'function') await middleware.run(req);
  }
  return validationResult(req);
}

test('createExpenseValidator: an ordinary (non-salary) expense still requires a vendor', async () => {
  const { createExpenseValidator } = require('../../utils/validators/expenseValidator');
  const expenseAccount = await ChartOfAccount.create({ code: 'EXP-1', name: 'Office Rent', type: 'expense' });
  const result = await runValidators(createExpenseValidator, { expenseAccount: expenseAccount._id.toString(), amount: 1000 });
  assert.equal(result.isEmpty(), false);
  assert.ok(result.array().some(e => /Vendor is required/.test(e.msg)), JSON.stringify(result.array()));
});

test('createExpenseValidator: an explicit expenseType "vendor" still requires a vendor', async () => {
  const { createExpenseValidator } = require('../../utils/validators/expenseValidator');
  const expenseAccount = await ChartOfAccount.create({ code: 'EXP-2', name: 'Office Rent', type: 'expense' });
  const result = await runValidators(createExpenseValidator, { expenseType: 'vendor', expenseAccount: expenseAccount._id.toString(), amount: 1000 });
  assert.equal(result.isEmpty(), false);
  assert.ok(result.array().some(e => /Vendor is required/.test(e.msg)), JSON.stringify(result.array()));
});

test('createExpenseValidator: a salary expense (expenseType: "salary") never requires a vendor', async () => {
  const { createExpenseValidator } = require('../../utils/validators/expenseValidator');
  const expenseAccount = await ChartOfAccount.create({ code: 'EXP-3', name: 'Salaries Expense', type: 'expense' });
  const result = await runValidators(createExpenseValidator, { expenseType: 'salary', expenseAccount: expenseAccount._id.toString(), amount: 5000 });
  assert.equal(result.isEmpty(), true, JSON.stringify(result.array()));
});

test('createExpenseValidator: a salary expense still validates the expense account like any other expense', async () => {
  const { createExpenseValidator } = require('../../utils/validators/expenseValidator');
  const notAnExpenseAccount = await ChartOfAccount.create({ code: 'EXP-4', name: 'Materials Inventory', type: 'asset' });
  const result = await runValidators(createExpenseValidator, { expenseType: 'salary', expenseAccount: notAnExpenseAccount._id.toString(), amount: 5000 });
  assert.equal(result.isEmpty(), false);
  assert.ok(result.array().some(e => /expense account/.test(e.msg)), JSON.stringify(result.array()));
});

test('createExpenseValidator: an invalid expenseType value is rejected', async () => {
  const { createExpenseValidator } = require('../../utils/validators/expenseValidator');
  const expenseAccount = await ChartOfAccount.create({ code: 'EXP-5', name: 'Office Rent', type: 'expense' });
  const result = await runValidators(createExpenseValidator, { expenseType: 'bogus', expenseAccount: expenseAccount._id.toString(), amount: 1000 });
  assert.equal(result.isEmpty(), false);
  assert.ok(result.array().some(e => /Expense type must be/.test(e.msg)), JSON.stringify(result.array()));
});
