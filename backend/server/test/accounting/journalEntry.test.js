const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_journal_entries';

let JournalEntry;
let ChartOfAccount;
let getNextJournalEntryNumber;
let cash;
let revenue;

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  JournalEntry = require('../../models/accounting/journalEntryModel');
  ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
  ({ getNextJournalEntryNumber } = require('../../services/accounting/journalEntryNumberService'));
  // See chartOfAccount.test.js's before() comment - avoids racing the unique index builds
  // (entryNumber, and the sourceType+sourceId partial index) under concurrent test-file load.
  await Promise.all([JournalEntry.init(), ChartOfAccount.init()]);
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  await JournalEntry.deleteMany({});
  await ChartOfAccount.deleteMany({});
  await mongoose.connection.collection('counters').deleteMany({});
  cash = await ChartOfAccount.create({ code: '1000', name: 'Cash', type: 'asset' });
  revenue = await ChartOfAccount.create({ code: '4000', name: 'Revenue', type: 'revenue' });
});

test('a balanced draft entry can be posted', async () => {
  const entryNumber = await getNextJournalEntryNumber();
  const entry = await JournalEntry.create({
    entryNumber,
    lines: [
      { account: cash._id, debit: 100, credit: 0 },
      { account: revenue._id, debit: 0, credit: 100 },
    ],
  });

  assert.equal(entry.status, 'draft');
  assert.equal(entry.totalDebit, 100);
  assert.equal(entry.totalCredit, 100);
  assert.equal(entry.isBalanced(), true);

  entry.status = 'posted';
  await entry.save();
  assert.equal(entry.status, 'posted');
});

test('an unbalanced entry is rejected at posting time', async () => {
  const entryNumber = await getNextJournalEntryNumber();
  const entry = await JournalEntry.create({
    entryNumber,
    lines: [
      { account: cash._id, debit: 100, credit: 0 },
      { account: revenue._id, debit: 0, credit: 40 },
    ],
  });

  entry.status = 'posted';
  await assert.rejects(() => entry.save(), /does not equal total credit/);
});

test('a line cannot have both a debit and a credit, or neither', async () => {
  const entryNumber = await getNextJournalEntryNumber();
  await assert.rejects(
    () =>
      JournalEntry.create({
        entryNumber,
        lines: [{ account: cash._id, debit: 100, credit: 100 }],
      }),
    /either a debit or a credit/
  );

  const entryNumber2 = await getNextJournalEntryNumber();
  await assert.rejects(
    () =>
      JournalEntry.create({
        entryNumber: entryNumber2,
        lines: [{ account: cash._id, debit: 0, credit: 0 }],
      }),
    /either a debit or a credit/
  );
});

test('a draft entry with fewer than two lines cannot be posted', async () => {
  const entryNumber = await getNextJournalEntryNumber();
  const entry = await JournalEntry.create({ entryNumber, lines: [{ account: cash._id, debit: 50, credit: 0 }] });
  entry.status = 'posted';
  await assert.rejects(() => entry.save(), /at least two lines/);
});

test('a posted entry cannot have its lines modified directly', async () => {
  const entryNumber = await getNextJournalEntryNumber();
  const entry = await JournalEntry.create({
    entryNumber,
    status: 'posted',
    lines: [
      { account: cash._id, debit: 100, credit: 0 },
      { account: revenue._id, debit: 0, credit: 100 },
    ],
  });

  entry.lines[0].debit = 200;
  await assert.rejects(() => entry.save(), /cannot have their lines modified/);
});

test('entryNumber is unique', async () => {
  const entryNumber = await getNextJournalEntryNumber();
  await JournalEntry.create({
    entryNumber,
    lines: [
      { account: cash._id, debit: 100, credit: 0 },
      { account: revenue._id, debit: 0, credit: 100 },
    ],
  });

  await assert.rejects(
    () =>
      JournalEntry.create({
        entryNumber,
        lines: [
          { account: cash._id, debit: 50, credit: 0 },
          { account: revenue._id, debit: 0, credit: 50 },
        ],
      }),
    err => err.code === 11000
  );
});

test('at most one journal entry can exist per (sourceType, sourceId) pair', async () => {
  const projectId = new mongoose.Types.ObjectId();
  const entryNumber1 = await getNextJournalEntryNumber();
  await JournalEntry.create({
    entryNumber: entryNumber1,
    sourceType: 'PROJECT_CREATION',
    sourceId: projectId,
    lines: [
      { account: cash._id, debit: 100, credit: 0 },
      { account: revenue._id, debit: 0, credit: 100 },
    ],
  });

  const entryNumber2 = await getNextJournalEntryNumber();
  await assert.rejects(
    () =>
      JournalEntry.create({
        entryNumber: entryNumber2,
        sourceType: 'PROJECT_CREATION',
        sourceId: projectId,
        lines: [
          { account: cash._id, debit: 100, credit: 0 },
          { account: revenue._id, debit: 0, credit: 100 },
        ],
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
    lines: [
      { account: cash._id, debit: 100, credit: 0 },
      { account: revenue._id, debit: 0, credit: 100 },
    ],
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
    lines: original.lines.map(line => ({
      account: line.account._id || line.account,
      debit: line.credit,
      credit: line.debit,
    })),
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
