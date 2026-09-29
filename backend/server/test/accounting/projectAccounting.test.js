const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_project_accounting';

let Project;
let JournalEntry;
let ChartOfAccount;
let User;
let createProjectCreationJournalEntry;
let user;
let transactionsSupported = true;

// Mirrors projectController.js#createProject's transaction shape (Project.create + the automatic
// journal entry, one session) without needing an HTTP layer - this codebase's existing tests
// (customerNumberService.test.js, productServiceModel.test.js) all exercise models/services
// directly rather than spinning up Express, so this follows the same convention.
async function createProjectWithAccounting(data, createdBy) {
  const session = await mongoose.startSession();
  try {
    let project;
    let journalEntry;
    await session.withTransaction(async () => {
      const [created] = await Project.create([{ ...data, remainingMoney: data.projectAmount, createdBy }], { session });
      project = created;
      journalEntry = await createProjectCreationJournalEntry(project, session, createdBy);
    });
    return { project, journalEntry };
  } finally {
    session.endSession();
  }
}

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  Project = require('../../models/project/projectModel');
  JournalEntry = require('../../models/accounting/journalEntryModel');
  ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
  User = require('../../models/userModel');
  ({ createProjectCreationJournalEntry } = require('../../services/project/projectAccountingService'));
  // See chartOfAccount.test.js's before() comment - avoids racing the unique index builds
  // (projectNumber, entryNumber) under concurrent test-file load.
  await Promise.all([Project.init(), JournalEntry.init(), ChartOfAccount.init()]);

  // Multi-document transactions require a replica set/mongos - the real deployment (Atlas
  // mongodb+srv://) always is one, but a bare local `mongod` Windows service is not by default
  // (see docs/database-initialization.md and reversia-roadmap.md). Detect this once so the
  // transaction-dependent tests below can skip with a clear message instead of failing with an
  // opaque driver error when run against a plain local instance.
  const probeSession = await mongoose.startSession();
  try {
    await probeSession.withTransaction(async () => {
      await mongoose.connection.collection('__txn_probe').insertOne({ ok: 1 }, { session: probeSession });
    });
    await mongoose.connection.collection('__txn_probe').drop().catch(() => {});
  } catch (err) {
    transactionsSupported = false;
  } finally {
    probeSession.endSession();
  }
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  await Project.deleteMany({});
  await JournalEntry.deleteMany({});
  await ChartOfAccount.deleteMany({});
  await User.deleteMany({});
  await mongoose.connection.collection('counters').deleteMany({});

  user = await User.create({ name: 'Test Admin', email: `admin-${Date.now()}@example.com`, role: 'admin', type: 'online' });
  await ChartOfAccount.create({ code: '1100', name: 'Accounts Receivable', type: 'asset' });
  await ChartOfAccount.create({ code: '2400', name: 'Unearned Revenue', type: 'liability' });
});

test('creating a project also creates exactly one balanced automatic journal entry', async t => {
  if (!transactionsSupported) return t.skip('local MongoDB is a standalone instance, not a replica set - transactions unavailable (works against the real Atlas cluster)');
  const { project, journalEntry } = await createProjectWithAccounting({ projectNumber: 'PRJ-001', projectAmount: 5000, executor: user._id }, user._id);

  const foundProject = await Project.findById(project._id);
  assert.ok(foundProject, 'project should exist');
  assert.equal(foundProject.projectNumber, 'PRJ-001');
  assert.equal(foundProject.projectAmount, 5000);

  const entries = await JournalEntry.find({ project: project._id });
  assert.equal(entries.length, 1, 'exactly one automatic journal entry must exist for the project');

  const entry = entries[0];
  assert.equal(String(entry.project._id || entry.project), String(project._id));
  assert.equal(entry.lines.some(l => l.projectNumber === 'PRJ-001'), true);
  assert.equal(entry.totalDebit, 5000);
  assert.equal(entry.totalCredit, 5000);
  assert.equal(entry.status, 'posted');
  assert.equal(journalEntry._id.toString(), entry._id.toString());
});

test('a retried/duplicated automatic journal entry request does not create a duplicate (idempotency)', async t => {
  if (!transactionsSupported) return t.skip('local MongoDB is a standalone instance, not a replica set - transactions unavailable (works against the real Atlas cluster)');
  const { project } = await createProjectWithAccounting({ projectNumber: 'PRJ-002', projectAmount: 1200, executor: user._id }, user._id);

  const session = await mongoose.startSession();
  await assert.rejects(
    () => session.withTransaction(() => createProjectCreationJournalEntry(project, session, user._id)),
    err => err.code === 11000,
    'a second attempt to create the PROJECT_CREATION entry for the same project must fail on the idempotency index'
  );
  session.endSession();

  const entries = await JournalEntry.find({ project: project._id });
  assert.equal(entries.length, 1, 'no duplicate automatic journal entry should exist after the retried request');
});

test('duplicate project numbers are rejected', async t => {
  if (!transactionsSupported) return t.skip('local MongoDB is a standalone instance, not a replica set - transactions unavailable (works against the real Atlas cluster)');
  await createProjectWithAccounting({ projectNumber: 'PRJ-003', projectAmount: 1000, executor: user._id }, user._id);

  await assert.rejects(() => createProjectWithAccounting({ projectNumber: 'PRJ-003', projectAmount: 2000, executor: user._id }, user._id), err => err.code === 11000);

  const entries = await JournalEntry.find({});
  assert.equal(entries.filter(e => e.lines.some(l => l.projectNumber === 'PRJ-003')).length, 1, 'the rejected duplicate must not leave a stray journal entry behind');
});

test('an invalid (zero/negative) project amount is rejected', async () => {
  await assert.rejects(() => Project.create({ projectNumber: 'PRJ-004', projectAmount: 0, executor: user._id, remainingMoney: 0 }), /greater than 0/);
  await assert.rejects(() => Project.create({ projectNumber: 'PRJ-005', projectAmount: -100, executor: user._id, remainingMoney: -100 }), /greater than 0/);
});

test('if the automatic journal entry cannot be created, the project creation is rolled back (transaction atomicity)', async t => {
  if (!transactionsSupported) return t.skip('local MongoDB is a standalone instance, not a replica set - transactions unavailable (works against the real Atlas cluster)');
  // Remove the accounts the automatic entry depends on, simulating an accounting-side failure.
  await ChartOfAccount.deleteMany({});

  await assert.rejects(() => createProjectWithAccounting({ projectNumber: 'PRJ-ROLLBACK', projectAmount: 900, executor: user._id }, user._id), /accounting entry could not be created/);

  const project = await Project.findOne({ projectNumber: 'PRJ-ROLLBACK' });
  assert.equal(project, null, 'the project must not exist after its accounting entry creation failed');

  const entries = await JournalEntry.find({});
  assert.equal(entries.length, 0, 'no orphan journal entry should exist either');
});

test('project retrieval and update', async t => {
  if (!transactionsSupported) return t.skip('local MongoDB is a standalone instance, not a replica set - transactions unavailable (works against the real Atlas cluster)');
  const { project } = await createProjectWithAccounting({ projectNumber: 'PRJ-006', projectAmount: 3000, name: 'Initial name', executor: user._id }, user._id);

  const found = await Project.findById(project._id);
  assert.equal(found.name, 'Initial name');

  found.name = 'Updated name';
  await found.save();

  const updated = await Project.findById(project._id);
  assert.equal(updated.name, 'Updated name');
  // projectNumber must remain unchanged through a normal update path.
  assert.equal(updated.projectNumber, 'PRJ-006');
});

test('a project can be created with department "Villa"', async () => {
  const project = await Project.create({ projectNumber: 'PRJ-DEPT-01', projectAmount: 1000, executor: user._id, department: 'Villa' });
  const found = await Project.findById(project._id);
  assert.equal(found.department, 'Villa');
});

test('a project can be created with department "Industrials"', async () => {
  const project = await Project.create({ projectNumber: 'PRJ-DEPT-02', projectAmount: 1000, executor: user._id, department: 'Industrials' });
  const found = await Project.findById(project._id);
  assert.equal(found.department, 'Industrials');
});

test('an invalid department value is rejected', async () => {
  await assert.rejects(
    () => Project.create({ projectNumber: 'PRJ-DEPT-03', projectAmount: 1000, executor: user._id, department: 'Marketing' }),
    /not a valid department/
  );
});

test('a project created without a department defaults to null and remains readable (backward compatibility)', async () => {
  const project = await Project.create({ projectNumber: 'PRJ-DEPT-04', projectAmount: 1000, executor: user._id });
  assert.equal(project.department, null);

  const found = await Project.findById(project._id);
  assert.equal(found.department, null, 'a project with no department must read back cleanly, not throw a cast/enum error');
});

test('department can be updated after creation, and cleared back to null', async () => {
  const project = await Project.create({ projectNumber: 'PRJ-DEPT-05', projectAmount: 1000, executor: user._id, department: 'Villa' });

  project.department = 'Industrials';
  await project.save();
  assert.equal((await Project.findById(project._id)).department, 'Industrials');

  project.department = null;
  await project.save();
  assert.equal((await Project.findById(project._id)).department, null, 'explicitly setting department to null must actually clear it in the database');
});
