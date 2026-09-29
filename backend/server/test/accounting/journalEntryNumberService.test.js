const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_journal_entry_numbers';

let Counter;
let getNextJournalEntryNumber;
let transactionsSupported = true;

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  Counter = require('../../models/config/counterModel');
  ({ getNextJournalEntryNumber } = require('../../services/accounting/journalEntryNumberService'));

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
  await Counter.deleteMany({});
});

test('allocates sequential numbers without a session, seeding the counter on first use', async () => {
  const first = await getNextJournalEntryNumber();
  const second = await getNextJournalEntryNumber();
  assert.equal(second, first + 1);
});

test('range exhaustion throws a clean business error, without wrapping around', async () => {
  await Counter.create({ _id: 'journalEntryNumber', seq: 998, min: 100, max: 999 });
  const first = await getNextJournalEntryNumber();
  assert.equal(first, 999);
  await assert.rejects(() => getNextJournalEntryNumber(), /exhausted/i);
});

// This is the exact regression test for the root-cause bug: getNextJournalEntryNumber used to
// unconditionally attempt Counter.create() on every call (to seed the counter "just in case").
// That is harmless outside a transaction (a duplicate-key error is just caught), but inside an
// ACTIVE multi-document transaction, once the counter document exists (true from the second call
// onward), that failed write poisons the entire transaction server-side - the very next operation
// then fails too, and session.withTransaction()'s automatic retry re-runs the same doomed
// sequence forever. This test calls getNextJournalEntryNumber TWICE inside one transaction (first
// call seeds + allocates #1 - the counter now exists; second call must NOT attempt to re-seed and
// must NOT poison the transaction) and asserts both succeed with sequential numbers. Before the
// fix, the second call inside the same transaction would hang/fail exactly like the reported
// "Transaction with { txnNumber: N } has been aborted" bug.
test('two consecutive allocations inside the SAME transaction both succeed (regression for the transaction-abort-loop bug)', async t => {
  if (!transactionsSupported) return t.skip('local MongoDB is a standalone instance, not a replica set - transactions unavailable (works against the real Atlas cluster)');

  const session = await mongoose.startSession();
  let first;
  let second;
  await session.withTransaction(async () => {
    first = await getNextJournalEntryNumber(session);
    second = await getNextJournalEntryNumber(session);
  });
  session.endSession();

  assert.equal(second, first + 1, 'both allocations inside one transaction must succeed and be sequential, not hang or throw a transaction-abort error');
});

// Same shape as above but across TWO separate transactions in sequence (closer to the real
// reverseJournalEntry/createProject call pattern: a fresh session per request, counter already
// seeded by a prior request) - this is the scenario that was failing 100% of the time in
// production before the fix.
test('allocating a number in a second, separate transaction after the counter already exists succeeds', async t => {
  if (!transactionsSupported) return t.skip('local MongoDB is a standalone instance, not a replica set - transactions unavailable (works against the real Atlas cluster)');

  // First transaction seeds the counter (mirrors the very first journal entry ever created).
  const session1 = await mongoose.startSession();
  let firstNumber;
  await session1.withTransaction(async () => {
    firstNumber = await getNextJournalEntryNumber(session1);
  });
  session1.endSession();

  // Second, independent transaction - the counter now exists. This is the exact call pattern of
  // reverseJournalEntry/createProject in production, and the one that used to hang/fail.
  const session2 = await mongoose.startSession();
  let secondNumber;
  await session2.withTransaction(async () => {
    secondNumber = await getNextJournalEntryNumber(session2);
  });
  session2.endSession();

  assert.equal(secondNumber, firstNumber + 1);
});
