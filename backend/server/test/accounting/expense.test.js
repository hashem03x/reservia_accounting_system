const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Expenses module (services/expenses/expenseService.js): Dr expense (+ input VAT) / Cr Suppliers
// (vendor) on creation, and payments through the existing Payment model posting Dr Suppliers /
// Cr the payment account - never inventory, never more than what is owed, all-or-nothing.

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_expenses';

const { AutomaticJournalAccountCodes: C } = require('../../utils/accountingConstants');

let Expense, ChartOfAccount, JournalEntry, Vendor, Warehouse, Payment;
let createExpense, addExpensePayment, updateExpense, getExpenseAccountOptions;
let transactionsSupported = true;
let vendor, warehouse, accounts;

const idStr = ref => String(ref?._id || ref);
const codeOf = id => Object.keys(accounts).find(key => idStr(accounts[key]) === idStr(id));
const linesOf = entry => entry.lines.map(l => [codeOf(l.account), l.debit, l.credit]);

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  // Warehouse before Payment (see orderTaxAndPayment.test.js for the circular-require note).
  Warehouse = require('../../models/inventory/warehouseModel');
  Payment = require('../../models/vendor/paymentModel');
  Expense = require('../../models/expense/expenseModel');
  ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
  JournalEntry = require('../../models/accounting/journalEntryModel');
  Vendor = require('../../models/vendor/vendor');
  ({ createExpense, addExpensePayment, updateExpense, getExpenseAccountOptions } = require('../../services/expenses/expenseService'));
  await Promise.all([Expense.init(), Payment.init(), ChartOfAccount.init(), JournalEntry.init(), Vendor.init()]);

  const probe = await mongoose.startSession();
  try {
    await probe.withTransaction(async () => {
      await mongoose.connection.collection('__txn_probe').insertOne({ ok: 1 }, { session: probe });
    });
  } catch (err) {
    transactionsSupported = false;
  } finally {
    probe.endSession();
  }
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  await Promise.all([Expense, ChartOfAccount, JournalEntry, Vendor, Warehouse, Payment].map(M => M.deleteMany({})));
  await mongoose.connection.collection('movements').deleteMany({});
  accounts = {
    rent: await ChartOfAccount.create({ code: '61000001', name: 'Office Rent', type: 'expense' }),
    inventory: await ChartOfAccount.create({ code: C.materialsInventory, name: 'Materials Inventory', type: 'asset' }),
    cash: await ChartOfAccount.create({ code: '11000001', name: 'Bank Misr', type: 'asset', parentGroupNameEn: 'Cash & Cash Equivalents' }),
    suppliers: await ChartOfAccount.create({ code: C.suppliers, name: 'Suppliers', type: 'liability' }),
    inputVat: await ChartOfAccount.create({ code: C.inputVat, name: 'Input VAT', type: 'asset' }),
  };
  vendor = await Vendor.create({ name: 'Landlord', contact: { phone: `010${Date.now()}`.slice(0, 11) } });
  warehouse = await Warehouse.create({ name: 'Head Office', location: 'Cairo', balance: 50000 });
});

async function inTx(work) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } finally {
    session.endSession();
  }
}

const RENT = (overrides = {}) => ({ vendor: vendor._id, expenseAccount: accounts.rent._id, amount: 10000, vatPercentage: 14, date: new Date('2026-09-01'), reference: 'SEP-RENT', notes: 'September rent', ...overrides });
const create = data => inTx(session => createExpense(data, null, session));
const pay = (expense, data) => inTx(session => addExpensePayment(expense._id, { paymentAccount: accounts.cash._id, warehouseId: warehouse._id, ...data }, null, session));
const vendorBalance = async () => (await Vendor.findById(vendor._id).lean()).balance;
const warehouseBalance = async () => (await Warehouse.findById(warehouse._id).lean()).balance;

function assertVendorLines(entry) {
  assert.equal(entry.totalDebit, entry.totalCredit);
  for (const line of entry.lines) {
    assert.equal(line.partyNumber, vendor.vendorNumber, 'Sub Account = Vendor Number');
    assert.equal(line.partyType, 'vendor');
    assert.ok(line.description);
    assert.equal(line.description, entry.description);
  }
}

test('expense account options are the active Chart of Accounts expense accounts', async () => {
  assert.deepEqual((await getExpenseAccountOptions()).map(a => a.name), ['Office Rent']);
});

test('creating an expense posts Dr expense + input VAT / Cr Suppliers (vendor) and touches no inventory', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  const expense = await create(RENT());
  const stored = await Expense.findById(expense._id).lean();
  assert.deepEqual(
    { amount: stored.amount, vat: stored.vatAmount, total: stored.totalAmount, paid: stored.paidAmount, status: stored.paymentStatus },
    { amount: 10000, vat: 1400, total: 11400, paid: 0, status: 'unpaid' }
  );
  assert.equal(idStr(stored.expenseAccount), idStr(accounts.rent));

  const entry = await JournalEntry.findById(stored.journalEntry).lean();
  assert.equal(entry.accountingAction, 'EXPENSE_RECORDED');
  assert.equal(entry.module, 'Expense');
  assert.equal(entry.description, 'Expense - Office Rent (SEP-RENT)');
  assert.deepEqual(linesOf(entry), [
    ['rent', 10000, 0],
    ['inputVat', 1400, 0],
    ['suppliers', 0, 11400],
  ]);
  assertVendorLines(entry);
  assert.equal(await vendorBalance(), 11400, 'owed to the vendor');
  assert.equal(await Payment.countDocuments({}), 0, 'not paid yet');
  assert.equal(await mongoose.connection.collection('movements').countDocuments({}), 0, 'no inventory movement');
  assert.equal(await JournalEntry.countDocuments({ 'lines.account': accounts.inventory._id }), 0, 'never Inventory');
});

test('only an expense account can be used; nothing is created otherwise', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  await assert.rejects(() => create(RENT({ expenseAccount: accounts.inventory._id })), /expense account/);
  assert.equal(await Expense.countDocuments({}), 0);
  assert.equal(await JournalEntry.countDocuments({}), 0);
});

test('payments: Dr Suppliers (vendor) / Cr the payment account, through the existing Payment model, never above what is owed', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  const expense = await create(RENT());
  await pay(expense, { amount: 4000, notes: 'First instalment' });

  let stored = await Expense.findById(expense._id).lean();
  assert.equal(stored.paidAmount, 4000);
  assert.equal(stored.paymentStatus, 'partially_paid');
  assert.equal(stored.payments.length, 1);

  const payment = await Payment.findById(stored.payments[0].payment).lean();
  assert.deepEqual(
    { category: payment.paymentCategory, type: payment.type, amount: payment.amountPaid, vendor: idStr(payment.vendorId), account: idStr(payment.paymentAccount) },
    { category: 'expense', type: 'out', amount: 4000, vendor: idStr(vendor), account: idStr(accounts.cash) }
  );
  const entry = await JournalEntry.findById(stored.payments[0].journalEntry).lean();
  assert.equal(entry.accountingAction, 'EXPENSE_PAYMENT_RECORDED');
  assert.equal(entry.description, 'First instalment');
  assert.deepEqual(linesOf(entry), [
    ['suppliers', 4000, 0],
    ['cash', 0, 4000],
  ]);
  assertVendorLines(entry);
  assert.equal(await vendorBalance(), 7400);
  assert.equal(await warehouseBalance(), 46000);

  await assert.rejects(() => pay(expense, { amount: 7400.01 }), /exceeds the remaining amount \(7400\)/);
  await pay(expense, { amount: 7400 });
  stored = await Expense.findById(expense._id).lean();
  assert.equal(stored.paymentStatus, 'paid');
  assert.equal(stored.paidAmount, 11400);
  await assert.rejects(() => pay(expense, { amount: 1 }), /exceeds the remaining amount \(0\)/);
  assert.equal(await vendorBalance(), 0);
  assert.equal(await Payment.countDocuments({}), 2);
});

test('only Cash / Cash Equivalent accounts can be the payment method', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  const expense = await create(RENT());
  await assert.rejects(() => pay(expense, { amount: 100, paymentAccount: accounts.rent._id }), /Cash or Cash Equivalent/);
  assert.equal(await Payment.countDocuments({}), 0);
});

test('two simultaneous payments of the full amount cannot both go through', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  const expense = await create(RENT());
  const outcomes = await Promise.allSettled([pay(expense, { amount: 11400 }), pay(expense, { amount: 11400 })]);
  assert.equal(outcomes.filter(o => o.status === 'fulfilled').length, 1, outcomes.map(o => o.reason?.message).join(' | '));
  const stored = await Expense.findById(expense._id).lean();
  assert.equal(stored.paidAmount, 11400);
  assert.equal(await Payment.countDocuments({}), 1);
  assert.equal(await JournalEntry.countDocuments({ accountingAction: 'EXPENSE_PAYMENT_RECORDED' }), 1);
  assert.equal(await vendorBalance(), 0);
});

test('an expense can be paid immediately on creation', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  const expense = await create(RENT({ payment: { paymentAccount: accounts.cash._id, warehouseId: warehouse._id } }));
  const stored = await Expense.findById(expense._id).lean();
  assert.equal(stored.paymentStatus, 'paid');
  assert.equal(stored.paidAmount, 11400);
  assert.deepEqual((await JournalEntry.find({}).sort({ entryNumber: 1 }).lean()).map(e => e.accountingAction), ['EXPENSE_RECORDED', 'EXPENSE_PAYMENT_RECORDED']);
  assert.equal(await vendorBalance(), 0);
});

test('a failure while posting the payment entry rolls everything back', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  const expense = await create(RENT());
  const originalCreate = JournalEntry.create;
  JournalEntry.create = function (docs, ...rest) {
    if (Array.isArray(docs) && docs[0]?.accountingAction === 'EXPENSE_PAYMENT_RECORDED') throw new Error('forced payment entry failure');
    return originalCreate.call(this, docs, ...rest);
  };
  try {
    await assert.rejects(() => pay(expense, { amount: 1000 }), /forced payment entry failure/);
    // And on creation with an immediate payment: no expense either.
    await assert.rejects(() => create(RENT({ reference: 'OCT', payment: { paymentAccount: accounts.cash._id, warehouseId: warehouse._id } })), /forced payment entry failure/);
  } finally {
    JournalEntry.create = originalCreate;
  }
  assert.equal(await Payment.countDocuments({}), 0);
  assert.equal(await Expense.countDocuments({}), 1, 'the second expense was rolled back');
  assert.equal((await Expense.findById(expense._id).lean()).paidAmount, 0);
  assert.equal(await JournalEntry.countDocuments({}), 1, 'only the first expense entry');
  assert.equal(await vendorBalance(), 11400);
  assert.equal(await warehouseBalance(), 50000);
});

test('editing changes only reference/notes; legacy category expenses stay valid', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  const expense = await create(RENT());
  await inTx(session => updateExpense(expense._id, { notes: 'Updated', reference: 'R-1', amount: 1 }, session));
  const stored = await Expense.findById(expense._id).lean();
  assert.equal(stored.notes, 'Updated');
  assert.equal(stored.reference, 'R-1');
  assert.equal(stored.amount, 10000);

  const payment = await Payment.create({ warehouseId: warehouse._id, type: 'out', amountPaid: 50, paymentMethod: 'cash', paymentCategory: 'expense' });
  const legacy = await Expense.create({ description: 'Water', expenseCategory: 'finance-charges', paymentId: payment._id });
  assert.ok(legacy._id);
  await assert.rejects(() => Expense.create({ description: 'No category' }), /expenseCategory|paymentId/);
});
