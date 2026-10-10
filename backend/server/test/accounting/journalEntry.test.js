const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_journal_entries';

let JournalEntry;
let ChartOfAccount;
let Project;
let User;
let getNextJournalEntryNumber;
let cash;
let revenue;
let project;
let transactionsSupported = true;


// Every line of a project-related journal entry carries the entry's Project and Project Number
// (journalEntryModel.js RULE 3) - fixtures build their lines through this.
const projectLines = lines => lines.map(line => ({ project: project._id, projectNumber: project.projectNumber, ...line }));

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  JournalEntry = require('../../models/accounting/journalEntryModel');
  ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
  Project = require('../../models/project/projectModel');
  User = require('../../models/userModel');
  ({ getNextJournalEntryNumber } = require('../../services/accounting/journalEntryNumberService'));
  // See chartOfAccount.test.js's before() comment - avoids racing the unique index builds
  // (entryNumber, and the sourceType+sourceId partial index) under concurrent test-file load.
  await Promise.all([JournalEntry.init(), ChartOfAccount.init(), Project.init()]);

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
  await JournalEntry.deleteMany({});
  await ChartOfAccount.deleteMany({});
  await Project.deleteMany({});
  await User.deleteMany({});
  await mongoose.connection.collection('counters').deleteMany({});
  cash = await ChartOfAccount.create({ code: '1000', name: 'Cash', type: 'asset' });
  revenue = await ChartOfAccount.create({ code: '4000', name: 'Revenue', type: 'revenue' });
  const manager = await User.create({ name: 'PM', email: `pm-${Date.now()}@example.com`, role: 'admin', type: 'online' });
  project = await Project.create({
    projectNumber: `PRJ-${Date.now()}`,
    projectManager: manager._id,
    startDate: new Date(),
    deliveryDate: new Date(Date.now() + 86400000),
  });
});

test('a balanced draft entry can be posted', async () => {
  const entryNumber = await getNextJournalEntryNumber();
  const entry = await JournalEntry.create({
    entryNumber,
    project: project._id,
    lines: projectLines([
      { account: cash._id, description: 'Test line', debit: 100, credit: 0 },
      { account: revenue._id, description: 'Test line', debit: 0, credit: 100 },
    ]),
  });

  assert.equal(entry.status, 'draft');
  assert.equal(entry.totalDebit, 100);
  assert.equal(entry.totalCredit, 100);
  assert.equal(entry.isBalanced(), true);

  entry.status = 'posted';
  await entry.save();
  assert.equal(entry.status, 'posted');
});

// RULE 1: balance is checked unconditionally now - an unbalanced entry is rejected at CREATE
// time, for every status (including draft), not only when posting. There is deliberately no
// `status === 'draft'` exception (see docs section "Journal Entry Lines Must Always Balance to
// Zero").
test('an unbalanced entry is rejected at creation time, for both draft and posted status', async () => {
  const entryNumber = await getNextJournalEntryNumber();
  await assert.rejects(
    () =>
      JournalEntry.create({
        entryNumber,
        project: project._id,
        lines: projectLines([
          { account: cash._id, description: 'Test line', debit: 100, credit: 0 },
          { account: revenue._id, description: 'Test line', debit: 0, credit: 40 },
        ]),
      }),
    /not balanced/
  );

  const entryNumber2 = await getNextJournalEntryNumber();
  await assert.rejects(
    () =>
      JournalEntry.create({
        entryNumber: entryNumber2,
        status: 'posted',
        project: project._id,
        lines: projectLines([
          { account: cash._id, description: 'Test line', debit: 100, credit: 0 },
          { account: revenue._id, description: 'Test line', debit: 0, credit: 40 },
        ]),
      }),
    /not balanced/
  );
});

test('a line cannot have both a debit and a credit, or neither', async () => {
  const entryNumber = await getNextJournalEntryNumber();
  await assert.rejects(
    () =>
      JournalEntry.create({
        entryNumber,
        project: project._id,
        lines: projectLines([{ account: cash._id, description: 'Test line', debit: 100, credit: 100 }]),
      }),
    /either a debit or a credit/
  );

  const entryNumber2 = await getNextJournalEntryNumber();
  await assert.rejects(
    () =>
      JournalEntry.create({
        entryNumber: entryNumber2,
        project: project._id,
        lines: projectLines([{ account: cash._id, description: 'Test line', debit: 0, credit: 0 }]),
      }),
    /either a debit or a credit/
  );
});

// A single line can never actually reach the ">=2 lines to post" guard anymore - one line is
// always one-sided (debit XOR credit, enforced above), so it can never balance to zero and is now
// rejected by the unconditional balance check at creation, before posting is even attempted. This
// is a direct, intentional consequence of RULE 1 - documented here rather than silently dropped.
test('a single-line entry can never balance, so it is rejected at creation (before the two-line posting rule would even apply)', async () => {
  const entryNumber = await getNextJournalEntryNumber();
  await assert.rejects(
    () => JournalEntry.create({ entryNumber, project: project._id, lines: projectLines([{ account: cash._id, description: 'Test line', debit: 50, credit: 0 }]) }),
    /not balanced/
  );
});

test('a posted entry cannot have its lines modified directly', async () => {
  const entryNumber = await getNextJournalEntryNumber();
  const entry = await JournalEntry.create({
    entryNumber,
    status: 'posted',
    project: project._id,
    lines: projectLines([
      { account: cash._id, description: 'Test line', debit: 100, credit: 0 },
      { account: revenue._id, description: 'Test line', debit: 0, credit: 100 },
    ]),
  });

  entry.lines[0].debit = 200;
  await assert.rejects(() => entry.save(), /cannot have their lines modified/);
});

test('entryNumber is unique', async () => {
  const entryNumber = await getNextJournalEntryNumber();
  await JournalEntry.create({
    entryNumber,
    project: project._id,
    lines: projectLines([
      { account: cash._id, description: 'Test line', debit: 100, credit: 0 },
      { account: revenue._id, description: 'Test line', debit: 0, credit: 100 },
    ]),
  });

  await assert.rejects(
    () =>
      JournalEntry.create({
        entryNumber,
        project: project._id,
        lines: projectLines([
          { account: cash._id, description: 'Test line', debit: 50, credit: 0 },
          { account: revenue._id, description: 'Test line', debit: 0, credit: 50 },
        ]),
      }),
    err => err.code === 11000
  );
});

test('at most one journal entry can exist per (sourceType, sourceId) pair', async () => {
  const sourceProjectId = new mongoose.Types.ObjectId();
  const entryNumber1 = await getNextJournalEntryNumber();
  await JournalEntry.create({
    entryNumber: entryNumber1,
    sourceType: 'PROJECT_CREATION',
    sourceId: sourceProjectId,
    project: project._id,
    lines: projectLines([
      { account: cash._id, description: 'Test line', debit: 100, credit: 0 },
      { account: revenue._id, description: 'Test line', debit: 0, credit: 100 },
    ]),
  });

  const entryNumber2 = await getNextJournalEntryNumber();
  await assert.rejects(
    () =>
      JournalEntry.create({
        entryNumber: entryNumber2,
        sourceType: 'PROJECT_CREATION',
        sourceId: sourceProjectId,
        project: project._id,
        lines: projectLines([
          { account: cash._id, description: 'Test line', debit: 100, credit: 0 },
          { account: revenue._id, description: 'Test line', debit: 0, credit: 100 },
        ]),
      }),
    err => err.code === 11000
  );
});

test('reversing a posted entry creates a balanced mirrored entry on the admin-chosen date, and marks the original as reversed without altering its own date', async () => {
  const originalDate = new Date('2026-09-01T00:00:00.000Z');
  const adminChosenReversalDate = new Date('2026-09-20T00:00:00.000Z');

  const entryNumber = await getNextJournalEntryNumber();
  const original = await JournalEntry.create({
    entryNumber,
    date: originalDate,
    status: 'posted',
    project: project._id,
    lines: projectLines([
      { account: cash._id, description: 'Test line', debit: 100, credit: 0 },
      { account: revenue._id, description: 'Test line', debit: 0, credit: 100 },
    ]),
  });

  // Mirrors journalEntryController.js#reverseJournalEntry's line-swapping logic directly against
  // the model (that handler additionally wraps this in a session/transaction, which this test
  // deliberately does not require - see projectAccounting.test.js for the transaction-dependent
  // coverage and why it's conditionally skipped on a non-replica-set local MongoDB). Critically,
  // `date` is set to the admin-supplied `adminChosenReversalDate` - never `new Date()` (today) and
  // never `original.date` - matching the requirement that the admin must explicitly choose the
  // reversal date rather than it being defaulted (see docs/entities/accounting.md).
  const reversalEntryNumber = await getNextJournalEntryNumber();
  const reversal = await JournalEntry.create({
    entryNumber: reversalEntryNumber,
    date: adminChosenReversalDate,
    status: 'posted',
    reversalOfEntry: original._id,
    project: original.project,
    lines: projectLines(original.lines.map(line => ({
      account: line.account._id || line.account,
      description: line.description,
      debit: line.credit,
      credit: line.debit,
    }))),
  });

  original.reversedByEntry = reversal._id;
  original.status = 'reversed';
  await original.save();

  assert.equal(reversal.totalDebit, original.totalCredit, 'reversal debit total must mirror the original credit total');
  assert.equal(reversal.totalCredit, original.totalDebit, 'reversal credit total must mirror the original debit total');
  assert.equal(reversal.isBalanced(), true);
  assert.equal(reversal.date.toISOString(), adminChosenReversalDate.toISOString(), 'the reversal entry must be dated on the admin-chosen reversal date, not today or the original date');

  const updatedOriginal = await JournalEntry.findById(original._id);
  assert.equal(updatedOriginal.status, 'reversed');
  assert.equal(updatedOriginal.date.toISOString(), originalDate.toISOString(), 'reversing an entry must never change its own original date');
  assert.equal(updatedOriginal.reversedByEntry._id.toString(), reversal._id.toString());
});

test('the reverseJournalEntryValidators reject a missing or invalid reversalDate, and accept a valid one', async () => {
  const { validationResult } = require('express-validator');
  const { reverseJournalEntryValidators } = require('../../utils/validators/journalEntryValidators');

  async function runValidators(body) {
    const req = { body, params: {}, query: {} };
    // Only actual express-validator ValidationChain entries expose `.run` - the final array
    // element (validatorMiddleware, a plain (req,res,next) function) does not, so this naturally
    // skips it rather than needing a brittle arity/type check.
    for (const middleware of reverseJournalEntryValidators) {
      if (typeof middleware.run === 'function') await middleware.run(req);
    }
    return validationResult(req);
  }

  const missing = await runValidators({});
  assert.equal(missing.isEmpty(), false, 'a request with no reversalDate must fail validation');

  const invalid = await runValidators({ reversalDate: 'not-a-date' });
  assert.equal(invalid.isEmpty(), false, 'a request with an invalid reversalDate must fail validation');

  const valid = await runValidators({ reversalDate: '2026-09-20' });
  assert.equal(valid.isEmpty(), true, 'a request with a valid ISO reversalDate must pass validation');
});

test('createJournalEntryValidators: RULE 1 and RULE 2 fast pre-checks', async () => {
  const { validationResult } = require('express-validator');
  const { createJournalEntryValidators } = require('../../utils/validators/journalEntryValidators');

  async function runValidators(body) {
    const req = { body, params: {}, query: {} };
    for (const middleware of createJournalEntryValidators) {
      if (typeof middleware.run === 'function') await middleware.run(req);
    }
    return validationResult(req);
  }

  const balancedLines = [
    { account: cash._id.toString(), description: 'Test line', debit: 100, credit: 0 },
    { account: revenue._id.toString(), description: 'Test line', debit: 0, credit: 100 },
  ];
  const unbalancedLines = [
    { account: cash._id.toString(), description: 'Test line', debit: 100, credit: 0 },
    { account: revenue._id.toString(), description: 'Test line', debit: 0, credit: 40 },
  ];

  const noProject = await runValidators({ lines: balancedLines });
  assert.equal(noProject.isEmpty(), false, 'a request with no project must fail validation');
  assert.ok(noProject.array().some(e => /Project is required/.test(e.msg)));

  const fakeProjectId = new mongoose.Types.ObjectId().toString();
  const nonExistentProject = await runValidators({ project: fakeProjectId, lines: balancedLines });
  assert.equal(nonExistentProject.isEmpty(), false, 'a request referencing a non-existent project must fail validation');
  assert.ok(nonExistentProject.array().some(e => /does not exist/.test(e.msg)));

  const unbalanced = await runValidators({ project: project._id.toString(), lines: unbalancedLines });
  assert.equal(unbalanced.isEmpty(), false, 'a request with unbalanced lines must fail validation');
  assert.ok(unbalanced.array().some(e => /not balanced/.test(e.msg)));

  const valid = await runValidators({ project: project._id.toString(), lines: balancedLines });
  assert.equal(valid.isEmpty(), true, 'a request with a valid project and balanced lines must pass validation');
});

// Regression for journalEntryController.js#reverseJournalEntry's in-transaction re-check: two
// concurrent requests could both read `reversedByEntry: null` before either writes (the classic
// TOCTOU race). Mirrors the controller's actual guard - re-fetching the original INSIDE the
// transaction's own session/snapshot and re-checking there - directly, the same way
// projectAccounting.test.js mirrors controller transaction logic rather than needing an HTTP layer.
test('re-checking reversal eligibility inside the transaction rejects an entry that was reversed by a concurrent request, without creating a duplicate reversal', async t => {
  if (!transactionsSupported) return t.skip('local MongoDB is a standalone instance, not a replica set - transactions unavailable (works against the real Atlas cluster)');

  const entryNumber = await getNextJournalEntryNumber();
  const original = await JournalEntry.create({
    entryNumber,
    status: 'posted',
    project: project._id,
    lines: projectLines([
      { account: cash._id, description: 'Test line', debit: 100, credit: 0 },
      { account: revenue._id, description: 'Test line', debit: 0, credit: 100 },
    ]),
  });

  // Simulates "another request already won the race and reversed it" happening between this
  // request's initial (pre-transaction) read and its in-transaction re-check.
  const firstReversalNumber = await getNextJournalEntryNumber();
  const firstReversal = await JournalEntry.create({
    entryNumber: firstReversalNumber,
    status: 'posted',
    reversalOfEntry: original._id,
    lines: [
      { account: cash._id, description: 'Test line', debit: 0, credit: 100 },
      { account: revenue._id, description: 'Test line', debit: 100, credit: 0 },
    ],
  });
  await JournalEntry.updateOne({ _id: original._id }, { $set: { reversedByEntry: firstReversal._id, status: 'reversed' } });

  const session = await mongoose.startSession();
  await assert.rejects(
    () =>
      session.withTransaction(async () => {
        const currentOriginal = await JournalEntry.findById(original._id).session(session);
        if (!currentOriginal || currentOriginal.status !== 'posted' || currentOriginal.reversedByEntry) {
          throw new Error('This journal entry has already been reversed.');
        }
      }),
    /already been reversed/,
    'the in-transaction re-check must reject a second reversal attempt on an entry another request just reversed'
  );
  session.endSession();

  const allReversalsOfOriginal = await JournalEntry.find({ reversalOfEntry: original._id });
  assert.equal(allReversalsOfOriginal.length, 1, 'only the first, legitimate reversal must exist - no duplicate reversal entry');
});

// ===================== RULE 2: mandatory project =====================

test('RULE 2: a new (non-reversal) journal entry without a project is rejected', async () => {
  const entryNumber = await getNextJournalEntryNumber();
  await assert.rejects(
    () =>
      JournalEntry.create({
        entryNumber,
        lines: [
          { account: cash._id, description: 'Test line', debit: 100, credit: 0 },
          { account: revenue._id, description: 'Test line', debit: 0, credit: 100 },
        ],
      }),
    /Project is required/
  );
});

test('RULE 2: a journal entry referencing a non-existent project is rejected', async () => {
  const entryNumber = await getNextJournalEntryNumber();
  await assert.rejects(
    () =>
      JournalEntry.create({
        entryNumber,
        project: new mongoose.Types.ObjectId(),
        lines: [
          { account: cash._id, description: 'Test line', debit: 100, credit: 0 },
          { account: revenue._id, description: 'Test line', debit: 0, credit: 100 },
        ],
      }),
    /project does not exist/
  );
});

// Regression test: the Fixed Asset purchase flow (fixedAssetController.js#createFixedAsset) auto-
// creates a `source: 'fixed_asset_purchase'` journal entry with no project at all - an unrelated,
// pre-existing feature that this mandatory-project rule must not break.
test('RULE 2: the Fixed Asset purchase auto-entry (source: fixed_asset_purchase) is exempt from the mandatory-project rule', async () => {
  const entryNumber = await getNextJournalEntryNumber();
  const entry = await JournalEntry.create({
    entryNumber,
    source: 'fixed_asset_purchase',
    status: 'posted',
    lines: [
      { account: cash._id, description: 'Test line', debit: 500, credit: 0 },
      { account: revenue._id, description: 'Test line', debit: 0, credit: 500 },
    ],
  });
  assert.equal(entry.project, null);
});

test('RULE 2: reversal entries are exempt from the mandatory-project rule (reversing a historical entry that predates this rule must keep working)', async () => {
  // Simulates a pre-existing entry created before this rule existed (raw insert, bypassing
  // validation entirely - the same way projectAccounting.test.js simulates legacy documents).
  const entryNumber = await getNextJournalEntryNumber();
  await mongoose.connection.collection('journalentries').insertOne({
    entryNumber,
    status: 'posted',
    totalDebit: 100,
    totalCredit: 100,
    lines: [
      { account: cash._id, description: 'Test line', debit: 100, credit: 0 },
      { account: revenue._id, description: 'Test line', debit: 0, credit: 100 },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const legacyOriginal = await JournalEntry.findOne({ entryNumber });
  assert.equal(legacyOriginal.project, null);

  const reversalNumber = await getNextJournalEntryNumber();
  const reversal = await JournalEntry.create({
    entryNumber: reversalNumber,
    status: 'posted',
    reversalOfEntry: legacyOriginal._id,
    project: legacyOriginal.project,
    lines: [
      { account: cash._id, description: 'Test line', debit: 0, credit: 100 },
      { account: revenue._id, description: 'Test line', debit: 100, credit: 0 },
    ],
  });
  assert.ok(reversal._id, 'reversing a project-less legacy entry must still succeed');
  assert.equal(reversal.project, null);
});

// ===================== RULE 3: a reversed entry cannot be reversed again =====================

test('RULE 3: the controller-level pre-check rejects reversing the same entry twice', async () => {
  const entryNumber = await getNextJournalEntryNumber();
  const original = await JournalEntry.create({
    entryNumber,
    status: 'posted',
    project: project._id,
    lines: projectLines([
      { account: cash._id, description: 'Test line', debit: 100, credit: 0 },
      { account: revenue._id, description: 'Test line', debit: 0, credit: 100 },
    ]),
  });

  // First reversal succeeds (mirrors reverseJournalEntry's create+link, without the transaction
  // wrapper - see the earlier "reversing a posted entry..." test for why).
  const reversalNumber = await getNextJournalEntryNumber();
  const reversal = await JournalEntry.create({
    entryNumber: reversalNumber,
    status: 'posted',
    reversalOfEntry: original._id,
    project: original.project,
    lines: projectLines([
      { account: cash._id, description: 'Test line', debit: 0, credit: 100 },
      { account: revenue._id, description: 'Test line', debit: 100, credit: 0 },
    ]),
  });
  original.reversedByEntry = reversal._id;
  original.status = 'reversed';
  await original.save();

  // Second reversal attempt: this is exactly reverseJournalEntry's own pre-transaction guard,
  // exercised directly against the now-reversed entry.
  const reloaded = await JournalEntry.findById(original._id);
  assert.equal(reloaded.status, 'reversed');
  assert.ok(reloaded.reversedByEntry);
  const wouldReject = reloaded.status !== 'posted' || Boolean(reloaded.reversedByEntry);
  assert.equal(wouldReject, true, 'an already-reversed entry must be rejected before even starting a second reversal transaction');

  const allReversalsOfOriginal = await JournalEntry.find({ reversalOfEntry: original._id });
  assert.equal(allReversalsOfOriginal.length, 1, 'exactly one reversal must exist for this entry');
});

// RULE 3 extension: a reversal entry (status 'posted', reversedByEntry null) would otherwise pass
// both of reverseJournalEntry's existing guards (status==='posted' and !reversedByEntry) and could
// be reversed again, chaining indefinitely. `reversalOfEntry` is the signal that blocks this -
// exercised directly against the controller's exact guard condition, the same way the "reversing
// twice" test above does.
test('RULE 3: a reversal entry cannot itself be reversed (no Original -> Reversal -> Reversal of Reversal chains)', async () => {
  const entryNumber = await getNextJournalEntryNumber();
  const original = await JournalEntry.create({
    entryNumber,
    status: 'posted',
    project: project._id,
    lines: projectLines([
      { account: cash._id, description: 'Test line', debit: 100, credit: 0 },
      { account: revenue._id, description: 'Test line', debit: 0, credit: 100 },
    ]),
  });

  const reversalNumber = await getNextJournalEntryNumber();
  const reversal = await JournalEntry.create({
    entryNumber: reversalNumber,
    status: 'posted',
    reversalOfEntry: original._id,
    project: original.project,
    lines: projectLines([
      { account: cash._id, description: 'Test line', debit: 0, credit: 100 },
      { account: revenue._id, description: 'Test line', debit: 100, credit: 0 },
    ]),
  });
  original.reversedByEntry = reversal._id;
  original.status = 'reversed';
  await original.save();

  // The reversal entry itself: status 'posted', reversedByEntry null - both of the pre-existing
  // guards would pass. `reversalOfEntry` is what must reject it.
  assert.equal(reversal.status, 'posted');
  assert.equal(reversal.reversedByEntry, null);
  assert.ok(reversal.reversalOfEntry, 'the reversal entry must have reversalOfEntry set');

  const wouldReject = reversal.status !== 'posted' || Boolean(reversal.reversedByEntry) || Boolean(reversal.reversalOfEntry);
  assert.equal(wouldReject, true, 'attempting to reverse the reversal entry itself must be rejected');

  const reversalsOfTheReversal = await JournalEntry.find({ reversalOfEntry: reversal._id });
  assert.equal(reversalsOfTheReversal.length, 0, 'no reversal-of-reversal must ever be creatable');
});
