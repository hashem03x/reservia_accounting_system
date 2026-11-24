const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Go-live F14: "Post the closed HR month inside the platform to mapped ERP accounts and return
// the journal number to HR." Replaces the old external-HTTP postToErp (no real receiver, always
// failed) with a real JournalEntry posted into this platform's own Chart of Accounts.
// Needs a real replica set (postAutomaticJournalEntry runs inside a transaction) - self-skips
// without TEST_DB_URI, like every other DB-backed suite in this repo.

const DB_URI = process.env.TEST_DB_URI;
const RUN = !!DB_URI;
const maybeTest = RUN ? test : test.skip;

let ChartOfAccount, JournalEntry, User, hrCore, hrService, hrPayrollService, postHrPayrollJournal;

before(async () => {
  if (!RUN) return;
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
  JournalEntry = require('../../models/accounting/journalEntryModel');
  User = require('../../models/userModel');
  process.env.HR_PAY_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  hrCore = require('../../services/hr/hrCore');
  hrService = require('../../services/hr/hrService');
  hrPayrollService = require('../../services/hr/hrPayrollService');
  ({ postHrPayrollJournal } = require('../../services/accounting/hrPayrollAccountingService'));
  await Promise.all([ChartOfAccount.init(), JournalEntry.init(), User.init()]);
});

after(async () => {
  if (!RUN) return;
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  if (!RUN) return;
  const names = (await mongoose.connection.db.listCollections().toArray()).map(c => c.name);
  await Promise.all(names.map(n => mongoose.connection.collection(n).deleteMany({})));
});

const samplePayload = (overrides = {}) => ({
  company: 'Reservia', period: '2026-11',
  lines: [
    { account: '5100 Salaries and wages', debit: 10000, credit: 0, memo: 'Basic salaries' },
    { account: '2330 Salaries payable', debit: 0, credit: 10000, memo: 'Net salaries payable' },
  ],
  employees: [],
  ...overrides,
});

async function seedAccounts() {
  await ChartOfAccount.create([
    { code: '5100', name: 'Salaries and wages', type: 'expense' },
    { code: '2330', name: 'Salaries payable', type: 'liability' },
  ]);
}

/** Every default GL code payrollEngine.js#DEFAULTS.gl maps to - needed when posting a REAL
 * computed payroll month (not the hand-built samplePayload above), which also touches employer
 * insurance/insurance payable/tax payable even for a single basic-salary-only employee. */
async function seedAllDefaultAccounts() {
  await ChartOfAccount.create([
    { code: '5100', name: 'Salaries and wages', type: 'expense' },
    { code: '5110', name: 'Allowances', type: 'expense' },
    { code: '5120', name: 'Overtime', type: 'expense' },
    { code: '5130', name: 'Site and travel allowances', type: 'expense' },
    { code: '5140', name: 'Travel reimbursements', type: 'expense' },
    { code: '5150', name: 'Social insurance, employer', type: 'expense' },
    { code: '2310', name: 'Social insurance payable', type: 'liability' },
    { code: '2320', name: 'Income tax payable', type: 'liability' },
    { code: '2330', name: 'Salaries payable', type: 'liability' },
    { code: '2340', name: 'Martyrs Fund payable', type: 'liability' },
  ]);
}

maybeTest('postHrPayrollJournal: posts a real, balanced JournalEntry when every mapped account exists', async () => {
  await seedAccounts();
  const entry = await postHrPayrollJournal('2026-11', samplePayload());
  assert.ok(entry.entryNumber);
  assert.equal(entry.status, 'posted');
  assert.equal(entry.accountingAction, 'HR_PAYROLL_POST');
  assert.equal(entry.totalDebit, 10000);
  assert.equal(entry.totalCredit, 10000);
  assert.equal(entry.lines.length, 2);
});

maybeTest('postHrPayrollJournal: calling again for the SAME month returns the SAME entry, never a duplicate', async () => {
  await seedAccounts();
  const first = await postHrPayrollJournal('2026-11', samplePayload());
  const second = await postHrPayrollJournal('2026-11', samplePayload());
  assert.equal(String(first._id), String(second._id));
  assert.equal(await JournalEntry.countDocuments({ accountingAction: 'HR_PAYROLL_POST' }), 1);
});

maybeTest("postHrPayrollJournal: a DIFFERENT month posts its OWN entry, not blocked by the first month's idempotency key", async () => {
  await seedAccounts();
  const nov = await postHrPayrollJournal('2026-11', samplePayload());
  const dec = await postHrPayrollJournal('2026-12', samplePayload({ period: '2026-12' }));
  assert.notEqual(String(nov._id), String(dec._id));
});

maybeTest("postHrPayrollJournal: F14's exact finding - a mapped account that does not exist in the Chart of Accounts throws a clear, named error, never silently skips or fabricates it", async () => {
  // Only 5100 seeded - 2330 (Salaries payable) is "missing from the ERP chart", exactly like F14 found.
  await ChartOfAccount.create({ code: '5100', name: 'Salaries and wages', type: 'expense' });
  await assert.rejects(() => postHrPayrollJournal('2026-11', samplePayload()), /"2330" was not found/);
  assert.equal(await JournalEntry.countDocuments({}), 0, 'nothing is left half-posted');
});

maybeTest("hrPayrollService.postToErp: returns {ok:true, reference} on success - the frontend's own success branch, never an uncaught rejection", async () => {
  const md = await User.create({ name: 'Mona MD', email: `mona.${Date.now()}@reservia.test`, password: 'x', type: 'online', systemMemberships: [{ system: 'HR', role: 'md', isActive: true }] });
  const ctx = { user: md, role: 'md' };
  const month = hrCore.todayCairo().slice(0, 7);
  const M = require('../../models/hr/hrModels');
  // The repo's own realistic fixture (6 real employees, encrypted pay fields, real attendance) -
  // pay fields live in an encrypted payBox, never plain top-level fields (hrModels.js#employeeSchema),
  // so hand-rolling a single HrEmployee.create({basic: ...}) here would silently read back as 0.
  await hrService.loadExampleTeam({ user: md, role: 'md' });
  await M.HrPayrollRun.create({ month, status: 'approved', version: 1, log: [] });
  await seedAllDefaultAccounts();

  const succeeded = await hrPayrollService.postToErp(month, ctx);
  assert.equal(succeeded.ok, true, succeeded.error);
  assert.ok(succeeded.reference);
});
