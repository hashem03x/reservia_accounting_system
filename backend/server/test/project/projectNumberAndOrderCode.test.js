const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Covers the two new atomic Counter-based number generators added for Phase 2 (docs section
// "Automatic Project ID Generation" / "Order code fix"):
//   - projectNumberService.js#getNextProjectNumber - replaces free-text, client-supplied
//     Project.projectNumber.
//   - orderNumberService.js#getNextSalesOrderCode/getNextPurchaseOrderCode - replaces the
//     race-prone `Model.countDocuments({}) + 1` pattern in utils/helper.js.
// Both mirror journalEntryNumberService.js's pattern exactly, so this file mirrors
// journalEntryNumberService.test.js's own test shapes (sequential allocation, range exhaustion,
// same-transaction and cross-transaction safety) rather than inventing a different convention.

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_project_order_numbers';

let Counter;
let getNextProjectNumber;
let formatProjectNumber;
let getNextSalesOrderCode;
let getNextPurchaseOrderCode;
let transactionsSupported = true;

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  Counter = require('../../models/config/counterModel');
  ({ getNextProjectNumber, formatProjectNumber } = require('../../services/project/projectNumberService'));
  ({ getNextSalesOrderCode, getNextPurchaseOrderCode } = require('../../services/shared/orderNumberService'));

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

// ===================== Project Number =====================

test('getNextProjectNumber: allocates sequential, formatted numbers, seeding the counter on first use', async () => {
  const first = await getNextProjectNumber();
  const second = await getNextProjectNumber();
  assert.equal(first, formatProjectNumber(1));
  assert.equal(second, formatProjectNumber(2));
  assert.match(first, /^PRJ-\d{6}$/);
});

test('getNextProjectNumber: concurrent calls never collide (no two callers get the same number)', async () => {
  const results = await Promise.all(Array.from({ length: 20 }, () => getNextProjectNumber()));
  const unique = new Set(results);
  assert.equal(unique.size, 20, 'every concurrently-allocated project number must be unique');
});

test('getNextProjectNumber: range exhaustion throws a clean business error, without wrapping around', async () => {
  await Counter.create({ _id: 'projectNumber', seq: 1, min: 1, max: 2 });
  const first = await getNextProjectNumber();
  assert.equal(first, formatProjectNumber(2));
  await assert.rejects(() => getNextProjectNumber(), /exhausted/i);
});

test('getNextProjectNumber: two consecutive allocations inside the SAME transaction both succeed', async t => {
  if (!transactionsSupported) return t.skip('local MongoDB is a standalone instance, not a replica set - transactions unavailable (works against the real Atlas cluster)');

  const session = await mongoose.startSession();
  let first;
  let second;
  await session.withTransaction(async () => {
    first = await getNextProjectNumber(session);
    second = await getNextProjectNumber(session);
  });
  session.endSession();

  assert.notEqual(first, second);
});

// ===================== Sales/Purchase Order codes =====================

test('getNextSalesOrderCode / getNextPurchaseOrderCode: 12-digit zero-padded, same output format as the old generator', async () => {
  const soCode = await getNextSalesOrderCode();
  const poCode = await getNextPurchaseOrderCode();
  assert.match(soCode, /^\d{12}$/);
  assert.match(poCode, /^\d{12}$/);
  assert.equal(soCode, '000000000001');
  assert.equal(poCode, '000000000001');
});

test('getNextSalesOrderCode: concurrent calls never collide', async () => {
  const results = await Promise.all(Array.from({ length: 20 }, () => getNextSalesOrderCode()));
  const unique = new Set(results);
  assert.equal(unique.size, 20, 'every concurrently-allocated sales order code must be unique');
});

test('Sales Order and Purchase Order codes are independent sequences (one never consumes the other\'s numbers)', async () => {
  const so1 = await getNextSalesOrderCode();
  const po1 = await getNextPurchaseOrderCode();
  const so2 = await getNextSalesOrderCode();
  assert.equal(so1, '000000000001');
  assert.equal(po1, '000000000001');
  assert.equal(so2, '000000000002');
});
