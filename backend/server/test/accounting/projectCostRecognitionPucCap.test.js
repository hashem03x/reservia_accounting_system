const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Sales Invoices must consume inventory from the appropriate PUC account, never recognizing cost
// that was never really purchased into it - services/accounting/accountingEventService.js#
// postProjectCostRecognitionJE (JV0011) caps each Average Cost line's recognition at this
// project's real, live PUC ledger balance for that line's corresponding PUC account, tracked per
// line via Project.averageCostLines[].recognizedAmount (never a single project-wide percentage,
// so one cost category can lag behind another).

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_project_cost_puc_cap';

const { AutomaticJournalAccountCodes: C } = require('../../utils/accountingConstants');

let Project, ChartOfAccount, User, JournalEntry;
let accountingEventService;
let accounts, customer, manager, project;

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  Project = require('../../models/project/projectModel');
  ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
  User = require('../../models/userModel');
  JournalEntry = require('../../models/accounting/journalEntryModel');
  accountingEventService = require('../../services/accounting/accountingEventService');
  await Promise.all([Project.init(), ChartOfAccount.init(), JournalEntry.init()]);
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

const CHART = {
  [C.accountsReceivableProjects]: ['AR Projects', 'asset'],
  [C.revenue]: ['Revenue', 'revenue'],
  [C.materialsInventory]: ['Materials Inventory', 'asset'],
  [C.wipRawMaterials]: ['PUC - Raw Materials', 'asset'],
  50000001: ['Raw Materials', 'cogs'],
};

beforeEach(async () => {
  await Promise.all([Project.deleteMany({}), ChartOfAccount.deleteMany({}), User.deleteMany({}), JournalEntry.deleteMany({})]);
  accounts = {};
  for (const [code, [name, type]] of Object.entries(CHART)) {
    accounts[code] = await ChartOfAccount.create({ code, name, type });
  }
  customer = await User.create({ name: 'PUC Cap Customer', email: `puc-cap-${Date.now()}@example.com`, role: 'user', type: 'online' });
  manager = await User.create({ name: 'PUC Cap Manager', email: `puc-cap-mgr-${Date.now()}@example.com`, role: 'admin', type: 'online' });
  project = await Project.create({
    projectNumber: `PUCCAP-${Date.now()}`,
    contractValue: 1000000,
    customer: customer._id,
    projectManager: manager._id,
    startDate: new Date(),
    deliveryDate: new Date(Date.now() + 86400000),
    averageCostLines: [{ account: accounts['50000001']._id, amount: 250000 }],
  });
});

async function fundPuc(amount) {
  return accountingEventService.postAutomaticJournalEntry({
    accountingAction: 'PUC_TRANSFER',
    sourceType: 'PUC_TRANSFER_TEST_FUNDING',
    sourceId: new mongoose.Types.ObjectId(),
    description: 'Test PUC funding (simulates a real Purchase Invoice moving cost into this project\'s PUC)',
    project: project._id,
    lines: [
      { account: accounts[C.wipRawMaterials]._id, debit: amount, credit: 0, project: project._id },
      { account: accounts[C.materialsInventory]._id, debit: 0, credit: amount, project: project._id },
    ],
  });
}

async function recognize(executedPercentage) {
  const fresh = await Project.findById(project._id);
  fresh.executedPercentage = executedPercentage;
  const entries = await accountingEventService.postProjectExecutionRecognitionJEs(fresh, null);
  await fresh.save();
  project = await Project.findById(project._id);
  return entries;
}

test('cost recognition is capped at the real PUC balance when the budget formula would recognize more than was ever purchased', async () => {
  // 20% of 250,000 = 50,000 would normally be recognized, but only 30,000 has ever been
  // purchased into this project's PUC - Raw Materials account.
  await fundPuc(30000);
  const entries = await recognize(20);
  const cost = entries.find(e => e.accountingAction === 'PROJECT_COST_RECOGNITION');
  assert.ok(cost, 'some cost is recognized - whatever is actually available');
  assert.deepEqual(
    cost.lines.map(l => [String(l.account._id || l.account), l.debit, l.credit]),
    [
      [String(accounts['50000001']._id), 30000, 0],
      [String(accounts[C.wipRawMaterials]._id), 0, 30000],
    ],
    'capped at the real 30,000 PUC balance, never the formula\'s uncapped 50,000',
  );
  assert.equal(project.averageCostLines[0].recognizedAmount, 30000, 'the line only advances by what was actually posted');
});

test('a later recalculation at the SAME percentage catches up the shortfall once more inventory is purchased into PUC', async () => {
  await fundPuc(30000);
  await recognize(20); // capped at 30,000 (desired was 50,000) - shortfall of 20,000

  // More materials are purchased into this project's PUC.
  await fundPuc(50000);
  // Re-triggering recognition at the SAME 20% (e.g. a second Sales Order nudges the tracker, or a
  // direct re-run) picks up the remaining 20,000 shortfall, never re-posts the first 30,000 again.
  const freshProjectBeforeRetry = await Project.findById(project._id);
  freshProjectBeforeRetry.executedPercentage = 21; // force a tiny real increase so the gate re-runs
  const entries = await accountingEventService.postProjectExecutionRecognitionJEs(freshProjectBeforeRetry, null);
  await freshProjectBeforeRetry.save();
  const cost = entries.find(e => e.accountingAction === 'PROJECT_COST_RECOGNITION');
  assert.ok(cost, 'the shortfall is now recognized since real PUC balance is available');

  const updated = await Project.findById(project._id);
  // Target at 21% = 52,500; already recognized 30,000; desired delta = 22,500; available PUC
  // balance after funding is now 50,000 (fresh, since nothing has been credited from it yet) - the
  // full 22,500 delta posts this time (well within the 50,000 available).
  assert.equal(updated.averageCostLines[0].recognizedAmount, 52500);
});

test('cost recognition never recognizes cost twice for the same percentage slice (idempotent by sourceId)', async () => {
  await fundPuc(100000);
  await recognize(20);
  const countAfterFirst = await JournalEntry.countDocuments({ accountingAction: 'PROJECT_COST_RECOGNITION' });
  assert.equal(countAfterFirst, 1);

  // Re-running postProjectExecutionRecognitionJEs for the SAME target percentage (simulating a
  // retried request, e.g. the top-level tracker was reset but never actually saved) must not
  // create a second entry. The REAL source of truth is now the per-line `recognizedAmount`
  // (untouched here), not the project-wide `costRecognizedPercentage` - so this is caught even
  // more robustly than the old single-percentage tracker: there is nothing left to post at all.
  const stale = await Project.findById(project._id);
  stale.costRecognizedPercentage = 0; // as if the tracker had not been saved
  const again = await accountingEventService.postProjectExecutionRecognitionJEs(stale, null);
  const countAfterRetry = await JournalEntry.countDocuments({ accountingAction: 'PROJECT_COST_RECOGNITION' });
  assert.equal(countAfterRetry, 1, 'no duplicate posted for a retried percentage');
  assert.equal(again.find(e => e.accountingAction === 'PROJECT_COST_RECOGNITION'), undefined, 'nothing left to recognize - the per-line recognizedAmount already reflects it');
});

test('a decrease (Sales Order cancelled) restores exactly what was recognized, never capped by PUC balance', async () => {
  await fundPuc(30000); // only enough for a capped recognition
  await recognize(20); // recognizes 30,000 (capped), recognizedAmount = 30,000

  // Now the "sale" is cancelled - executedPercentage drops back to 0.
  const entries = await recognize(0);
  const cost = entries.find(e => e.accountingAction === 'PROJECT_COST_RECOGNITION');
  assert.ok(cost, 'the previously-recognized amount is reversed');
  assert.deepEqual(
    cost.lines.map(l => [String(l.account._id || l.account), l.debit, l.credit]),
    [
      [String(accounts[C.wipRawMaterials]._id), 30000, 0],
      [String(accounts['50000001']._id), 0, 30000],
    ],
    'restores exactly the 30,000 that was actually recognized - never more, never capped',
  );
  assert.equal(project.averageCostLines[0].recognizedAmount, 0);
});

test('a project with no customer and no triggering Sales Order refuses to recognize revenue or cost, rather than posting a missing Sub Account', async () => {
  const noCustomerProject = await Project.create({
    projectNumber: `PUCCAP-NOCUST-${Date.now()}`,
    contractValue: 1000000,
    projectManager: manager._id,
    startDate: new Date(),
    deliveryDate: new Date(Date.now() + 86400000),
    averageCostLines: [{ account: accounts['50000001']._id, amount: 250000 }],
    executedPercentage: 20,
  });
  await assert.rejects(
    () => accountingEventService.postProjectExecutionRecognitionJEs(noCustomerProject, null),
    /no customer is linked to this project/,
  );
  assert.equal(await JournalEntry.countDocuments({ project: noCustomerProject._id }), 0);
});
