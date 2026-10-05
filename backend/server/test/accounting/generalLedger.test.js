const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_general_ledger';

let JournalEntry;
let ChartOfAccount;
let Project;
let User;
let Vendor;
let SalesOrder;
let PurchaseOrder;
let Warehouse;
let getNextJournalEntryNumber;
let getAccountBalance;
let getTrialBalance;
let getGeneralLedgerLines;
let cash;
let unearnedRevenue;
let receivable;
let project;

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  JournalEntry = require('../../models/accounting/journalEntryModel');
  ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
  Project = require('../../models/project/projectModel');
  User = require('../../models/userModel');
  Vendor = require('../../models/vendor/vendor');
  SalesOrder = require('../../models/sales/salesOrderModel');
  PurchaseOrder = require('../../models/vendor/purchaseOrder');
  Warehouse = require('../../models/inventory/warehouseModel');
  require('../../models/inventory/productModel');
  ({ getNextJournalEntryNumber } = require('../../services/accounting/journalEntryNumberService'));
  ({ getAccountBalance, getTrialBalance, getGeneralLedgerLines } = require('../../services/accounting/generalLedgerService'));
  await Promise.all([JournalEntry.init(), ChartOfAccount.init(), Project.init(), Vendor.init(), SalesOrder.init(), PurchaseOrder.init()]);
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  await JournalEntry.deleteMany({});
  await ChartOfAccount.deleteMany({});
  await Project.deleteMany({});
  await User.deleteMany({});
  await Vendor.deleteMany({});
  await SalesOrder.deleteMany({});
  await PurchaseOrder.deleteMany({});
  await Warehouse.deleteMany({});
  await mongoose.connection.collection('counters').deleteMany({});
  cash = await ChartOfAccount.create({ code: '1000', name: 'Cash', type: 'asset' });
  receivable = await ChartOfAccount.create({ code: '1100', name: 'Accounts Receivable', type: 'asset' });
  unearnedRevenue = await ChartOfAccount.create({ code: '2400', name: 'Unearned Revenue', type: 'liability' });
  const manager = await User.create({ name: 'PM', email: `pm-${Date.now()}@example.com`, role: 'admin', type: 'online' });
  project = await Project.create({
    projectNumber: `PRJ-${Date.now()}`,
    projectManager: manager._id,
    startDate: new Date(),
    deliveryDate: new Date(Date.now() + 86400000),
  });
});

async function postEntry(lines) {
  const entryNumber = await getNextJournalEntryNumber();
  return JournalEntry.create({ entryNumber, status: 'posted', project: project._id, lines });
}

test('account balance = total debits - total credits, even when credits exceed debits (no account-type sign flip)', async () => {
  // Debit-heavy: 150,000 debit, 30,000 credit -> +120,000 (matches master-spec worked example).
  await postEntry([
    { account: receivable._id, debit: 100000, credit: 0 },
    { account: cash._id, debit: 0, credit: 100000 },
  ]);
  await postEntry([
    { account: receivable._id, debit: 50000, credit: 0 },
    { account: cash._id, debit: 0, credit: 50000 },
  ]);
  await postEntry([
    { account: cash._id, debit: 30000, credit: 0 },
    { account: receivable._id, debit: 0, credit: 30000 },
  ]);

  const balance = await getAccountBalance(receivable._id);
  assert.equal(balance.debit, 150000);
  assert.equal(balance.credit, 30000);
  assert.equal(balance.balance, 120000);
});

test('a liability account with more credits than debits shows a NEGATIVE balance (debit - credit, unconditionally)', async () => {
  await postEntry([
    { account: receivable._id, debit: 100000, credit: 0 },
    { account: unearnedRevenue._id, debit: 0, credit: 100000 },
  ]);

  const balance = await getAccountBalance(unearnedRevenue._id);
  assert.equal(balance.debit, 0);
  assert.equal(balance.credit, 100000);
  assert.equal(balance.balance, -100000, 'a liability account is NOT sign-flipped to show a positive "natural" balance - debit minus credit is reported as-is');
});

test('draft (unposted) entries do not affect account balances', async () => {
  const entryNumber = await getNextJournalEntryNumber();
  await JournalEntry.create({
    entryNumber,
    status: 'draft',
    project: project._id,
    lines: [
      { account: cash._id, debit: 500, credit: 0 },
      { account: receivable._id, debit: 0, credit: 500 },
    ],
  });

  const balance = await getAccountBalance(cash._id);
  assert.equal(balance.debit, 0);
  assert.equal(balance.credit, 0);
  assert.equal(balance.balance, 0);
});

test('trial balance rows include a signed balance per account, and the total balance across the whole ledger is zero for balanced posted data', async () => {
  await postEntry([
    { account: cash._id, debit: 100000, credit: 0 },
    { account: unearnedRevenue._id, debit: 0, credit: 100000 },
  ]);
  await postEntry([
    { account: receivable._id, debit: 50000, credit: 0 },
    { account: cash._id, debit: 0, credit: 50000 },
  ]);

  const rows = await getTrialBalance();
  assert.equal(rows.length, 3);

  const totalBalance = rows.reduce((sum, row) => sum + row.balance, 0);
  // Not approximately zero - exactly zero (within the app's own 2-decimal rounding), because every
  // posted entry is individually balanced by construction (see journalEntryModel.js's pre-save
  // guard) - summing debit-credit across every account therefore always cancels out exactly.
  assert.equal(Math.round(totalBalance * 100) / 100, 0, 'the total balance across all accounts must be zero when every posted entry is individually balanced');

  const cashRow = rows.find(r => r.account.code === '1000');
  assert.equal(cashRow.balance, 50000);
});

test('getAccountBalance returns null for a non-existent account instead of throwing', async () => {
  const bogusId = new mongoose.Types.ObjectId();
  const balance = await getAccountBalance(bogusId);
  assert.equal(balance, null);
});

// ===================== getGeneralLedgerLines (docs section "Journal Entries / General Ledger table") =====================

test('getGeneralLedgerLines: running balance accumulates chronologically per account, across separate entries (not reset per page/entry)', async () => {
  await postEntry([
    { account: cash._id, debit: 1000, credit: 0 },
    { account: receivable._id, debit: 0, credit: 1000 },
  ]);
  await postEntry([
    { account: cash._id, debit: 0, credit: 400 },
    { account: receivable._id, debit: 400, credit: 0 },
  ]);
  await postEntry([
    { account: cash._id, debit: 250, credit: 0 },
    { account: receivable._id, debit: 0, credit: 250 },
  ]);

  const result = await getGeneralLedgerLines({ page: 1, limit: 50 });
  const cashRows = result.data.filter(r => r.accNumber === cash.code);
  assert.equal(cashRows.length, 3);
  // 1000, then 1000-400=600, then 600+250=850 - strictly cumulative, in entry order.
  assert.deepEqual(cashRows.map(r => r.balanceDocumentCurrency), [1000, 600, 850]);
});

test('getGeneralLedgerLines: local-currency balance applies each line\'s own exchangeRate, cumulatively', async () => {
  await postEntry([
    { account: cash._id, debit: 100, credit: 0, currency: 'USD', exchangeRate: 50 },
    { account: receivable._id, debit: 0, credit: 100, currency: 'USD', exchangeRate: 50 },
  ]);

  const result = await getGeneralLedgerLines({ page: 1, limit: 50 });
  const cashRow = result.data.find(r => r.accNumber === cash.code);
  assert.equal(cashRow.rate, 50);
  assert.equal(cashRow.balanceDocumentCurrency, 100, 'document-currency balance uses the raw debit/credit, unaffected by rate');
  assert.equal(cashRow.balanceLocalCurrency, 5000, 'local-currency balance = debit/credit * rate, cumulative');
});

test('getGeneralLedgerLines: a line with no currency/exchangeRate defaults to rate 1 (never recalculated from a current rate)', async () => {
  await postEntry([
    { account: cash._id, debit: 500, credit: 0 },
    { account: receivable._id, debit: 0, credit: 500 },
  ]);

  const result = await getGeneralLedgerLines({ page: 1, limit: 50 });
  const cashRow = result.data.find(r => r.accNumber === cash.code);
  assert.equal(cashRow.rate, 1);
  assert.equal(cashRow.balanceLocalCurrency, cashRow.balanceDocumentCurrency);
});

test('getGeneralLedgerLines: Sub Account resolves to the Customer Number for a Sales-Order-sourced entry', async () => {
  const customer = await User.create({ name: 'GL Customer', email: `gl-customer-${Date.now()}@example.com`, role: 'user', type: 'online' });
  const salesOrder = await SalesOrder.create({ customer: customer._id, orderSource: 'cashier', items: [] });

  const entryNumber = await getNextJournalEntryNumber();
  await JournalEntry.create({
    entryNumber,
    status: 'posted',
    source: 'automatic',
    sourceType: 'SO',
    sourceId: salesOrder._id,
    accountingAction: 'SO_PAYMENT_RECORDED',
    project: project._id,
    lines: [
      { account: cash._id, debit: 777, credit: 0 },
      { account: receivable._id, debit: 0, credit: 777 },
    ],
  });

  const result = await getGeneralLedgerLines({ page: 1, limit: 50 });
  const row = result.data.find(r => r.debit === 777);
  assert.deepEqual(row.subAccount, { type: 'customer', number: customer.customerNumber });
});

test('getGeneralLedgerLines: Sub Account resolves to the Vendor Number for a Purchase-Order-sourced entry', async () => {
  const vendor = await Vendor.create({ name: 'GL Vendor', contact: { phone: `010${Date.now()}`.slice(0, 11) } });
  const warehouse = await Warehouse.create({ name: 'GL Warehouse', location: 'Cairo' });
  const purchaseOrder = await PurchaseOrder.create({ vendorId: vendor._id, warehouseId: warehouse._id, items: [] });

  const entryNumber = await getNextJournalEntryNumber();
  await JournalEntry.create({
    entryNumber,
    status: 'posted',
    source: 'automatic',
    sourceType: 'PO',
    sourceId: purchaseOrder._id,
    accountingAction: 'PO_PAYMENT_RECORDED',
    lines: [
      { account: receivable._id, debit: 888, credit: 0 },
      { account: cash._id, debit: 0, credit: 888 },
    ],
  });

  const result = await getGeneralLedgerLines({ page: 1, limit: 50 });
  const row = result.data.find(r => r.debit === 888);
  assert.deepEqual(row.subAccount, { type: 'vendor', number: vendor.vendorNumber });
});

test('getGeneralLedgerLines: a manual entry (no sourceType/sourceId) has a null Sub Account, never fabricated', async () => {
  await postEntry([
    { account: cash._id, debit: 10, credit: 0 },
    { account: receivable._id, debit: 0, credit: 10 },
  ]);

  const result = await getGeneralLedgerLines({ page: 1, limit: 50 });
  const row = result.data.find(r => r.debit === 10);
  assert.equal(row.subAccount, null);
});

test('getGeneralLedgerLines: a dangling sourceId (referenced document no longer exists) resolves to a null Sub Account instead of crashing', async () => {
  const entryNumber = await getNextJournalEntryNumber();
  await JournalEntry.create({
    entryNumber,
    status: 'posted',
    source: 'automatic',
    sourceType: 'SO',
    sourceId: new mongoose.Types.ObjectId(), // no SalesOrder with this id exists
    accountingAction: 'SO_PAYMENT_RECORDED',
    lines: [
      { account: cash._id, debit: 42, credit: 0 },
      { account: receivable._id, debit: 0, credit: 42 },
    ],
  });

  const result = await getGeneralLedgerLines({ page: 1, limit: 50 });
  const row = result.data.find(r => r.debit === 42);
  assert.equal(row.subAccount, null);
});

test('getGeneralLedgerLines: Project Number prefers the live project\'s own projectNumber over a denormalized/stale lines.projectNumber', async () => {
  await postEntry([
    { account: cash._id, debit: 15, credit: 0, project: project._id, projectNumber: 'STALE-NUMBER' },
    { account: receivable._id, debit: 0, credit: 15, project: project._id, projectNumber: 'STALE-NUMBER' },
  ]);

  const result = await getGeneralLedgerLines({ page: 1, limit: 50 });
  const row = result.data.find(r => r.debit === 15);
  assert.equal(row.projectNumber, project.projectNumber, 'must use the live Project.projectNumber, not the stale denormalized string');
  assert.notEqual(row.projectNumber, 'STALE-NUMBER');
});

test('getGeneralLedgerLines: response shape matches the existing PaginatedData convention (results/paginationResult/data)', async () => {
  await postEntry([
    { account: cash._id, debit: 1, credit: 0 },
    { account: receivable._id, debit: 0, credit: 1 },
  ]);

  const result = await getGeneralLedgerLines({ page: 1, limit: 1 });
  assert.ok('results' in result);
  assert.ok('paginationResult' in result);
  assert.ok('data' in result);
  assert.equal(typeof result.paginationResult.currentPage, 'number');
  assert.equal(typeof result.paginationResult.numberOfPages, 'number');
});
