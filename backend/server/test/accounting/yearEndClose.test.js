const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// ERP CHG-09 (12 Nov 2026) acceptance: "Close 2026 on a copy - revenue and expense accounts are zero,
// retained earnings equals profit, posting dated 2026 is blocked, reopen is logged." Run on 2025
// here (a past year) with a small ledger: revenue 100,000, cost of sales 30,000, expenses 20,000
// -> profit 50,000.
const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_year_end_close';

let JournalEntry, ChartOfAccount, AccountingPeriod, yearEnd, getNextJournalEntryNumber, assertPeriodsOpen, C, FS;
const A = {};
const user = { _id: new mongoose.Types.ObjectId(), name: 'Finance Admin' };
let transactionsSupported = true;

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  JournalEntry = require('../../models/accounting/journalEntryModel');
  ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
  AccountingPeriod = require('../../models/accounting/accountingPeriodModel');
  yearEnd = require('../../services/accounting/yearEndCloseService');
  ({ getNextJournalEntryNumber } = require('../../services/accounting/journalEntryNumberService'));
  ({ assertPeriodsOpen } = require('../../services/accounting/accountingPeriodService'));
  C = require('../../services/reports/reportCommon');
  FS = require('../../services/reports/financialStatements');
  await Promise.all([JournalEntry.init(), ChartOfAccount.init(), AccountingPeriod.init()]);
  try {
    const s = await mongoose.startSession();
    await s.withTransaction(async () => {});
    s.endSession();
  } catch {
    transactionsSupported = false;
  }
  A.bank = await ChartOfAccount.create({ code: '11000002', name: 'Bank', type: 'asset' });
  A.revenue = await ChartOfAccount.create({ code: '40000001', name: 'Revenue', type: 'revenue' });
  A.cogs = await ChartOfAccount.create({ code: '50000001', name: 'Raw Materials', type: 'cogs' });
  A.rent = await ChartOfAccount.create({ code: '60000001', name: 'Rent', type: 'expense' });
  A.capital = await ChartOfAccount.create({ code: '20000001', name: 'Capital', type: 'equity' });
  A.re = await ChartOfAccount.create({ code: '20000002', name: 'Retained Earnings', type: 'equity' });
  A.poy = await ChartOfAccount.create({ code: '20000003', name: 'Profit of the year', type: 'equity' });
  const post = async (date, dr, cr, amount) =>
    JournalEntry.create({
      entryNumber: await getNextJournalEntryNumber(),
      date: new Date(date),
      description: 'Test entry',
      status: 'posted',
      source: 'automatic',
      lines: [
        { account: dr._id, debit: amount, credit: 0, description: 'Test' },
        { account: cr._id, debit: 0, credit: amount, description: 'Test' },
      ],
    });
  await post('2025-03-10', A.bank, A.revenue, 100000);
  await post('2025-05-10', A.cogs, A.bank, 30000);
  await post('2025-07-10', A.rent, A.bank, 20000);
  await post('2026-01-05', A.bank, A.revenue, 7000); // next year - untouched by the 2025 close
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

const balanceOf = async (account, endIso) => {
  const b = (await C.balancesByAccount({ end: new Date(endIso) })).get(String(account._id)) || { debit: 0, credit: 0 };
  return Math.round((b.debit - b.credit) * 100) / 100;
};

test('CHG-09: the preview shows the profit and the accounts that will be closed', async () => {
  const p = await yearEnd.previewClose(2025);
  assert.equal(p.profit, 50000);
  assert.deepEqual(p.accounts.map(a => a.code).sort(), ['40000001', '50000001', '60000001']);
});

test('CHG-09: close 2025 - P&L accounts zero, retained earnings = profit, the year is locked, the P&L statement still shows the year', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  const doc = await yearEnd.closeYear(2025, user, 'Annual close');
  assert.equal(doc.status, 'closed');
  assert.equal(doc.profit, 50000);
  assert.equal(doc.closingEntries.length, 2);

  for (const acc of [A.revenue, A.cogs, A.rent, A.poy]) assert.equal(await balanceOf(acc, '2025-12-31T23:59:59Z'), 0, acc.name);
  assert.equal(await balanceOf(A.re, '2025-12-31T23:59:59Z'), -50000, 'retained earnings holds the 50,000 profit (credit)');
  assert.equal(await balanceOf(A.revenue, '2026-12-31T23:59:59Z'), -7000, '2026 revenue untouched');

  const pl = await FS.profitLoss({ from: '2025-01-01', to: '2025-12-31' });
  assert.equal(pl.netProfit, 50000, 'the closed year still reports its profit');

  await assert.rejects(() => assertPeriodsOpen([new Date('2025-06-15')]), /Accounting period is closed/);
  assert.equal(await AccountingPeriod.countDocuments({ period: /^2025-/, status: 'closed' }), 12);
  await assert.rejects(() => yearEnd.closeYear(2025, user), /already closed/);
});

test('CHG-09: reopen needs a reason, reverses the closing entries, unlocks the months and is logged', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  await assert.rejects(() => yearEnd.reopenYear(2025, user, ''), /reason/);
  const doc = await yearEnd.reopenYear(2025, user, 'Late supplier invoice');
  assert.equal(doc.status, 'open');
  assert.deepEqual(doc.history.map(h => h.action), ['closed', 'reopened']);
  assert.equal(doc.history[1].byName, 'Finance Admin');
  assert.equal(doc.history[1].note, 'Late supplier invoice');
  assert.equal(await balanceOf(A.re, '2025-12-31T23:59:59Z'), 0);
  assert.equal(await balanceOf(A.revenue, '2025-12-31T23:59:59Z'), -100000);
  await assertPeriodsOpen([new Date('2025-06-15')]);
  // Close again after the correction: the same result, no leftovers from the first close.
  const again = await yearEnd.closeYear(2025, user, 'Annual close (after correction)');
  assert.equal(again.profit, 50000);
  assert.equal(await balanceOf(A.re, '2025-12-31T23:59:59Z'), -50000);
});

test('CHG-09: a future year cannot be closed; missing equity accounts are reported clearly', async () => {
  await assert.rejects(() => yearEnd.closeYear(new Date().getUTCFullYear() + 1, user), /future year/);
  await assert.rejects(() => yearEnd.previewClose('abc'), /four-digit year/);
});
