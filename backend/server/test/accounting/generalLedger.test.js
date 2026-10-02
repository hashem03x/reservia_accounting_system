const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_general_ledger';

let JournalEntry;
let ChartOfAccount;
let Project;
let User;
let getNextJournalEntryNumber;
let getAccountBalance;
let getTrialBalance;
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
  ({ getNextJournalEntryNumber } = require('../../services/accounting/journalEntryNumberService'));
  ({ getAccountBalance, getTrialBalance } = require('../../services/accounting/generalLedgerService'));
  await Promise.all([JournalEntry.init(), ChartOfAccount.init(), Project.init()]);
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
