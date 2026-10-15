const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Covers the two new atomic Counter-based number generators added for Phase 2 (docs section
// "Automatic Project ID Generation" / "Order code fix"):
//   - projectNumberService.js#getNextProjectNumber - sector-based `SECTOR_PREFIX-0000001` format,
//     replacing free-text, client-supplied Project.projectNumber. Format: "SECTOR_PREFIX-0000001",
//     one independent sequence per 3-letter sector prefix.
//   - orderNumberService.js#getNextSalesOrderCode/getNextPurchaseOrderCode - replaces the
//     race-prone `Model.countDocuments({}) + 1` pattern in utils/helper.js.
// Both mirror journalEntryNumberService.js's pattern exactly, so this file mirrors
// journalEntryNumberService.test.js's own test shapes (sequential allocation, range exhaustion,
// same-transaction and cross-transaction safety) rather than inventing a different convention.

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_project_order_numbers';

let Counter;
let getNextProjectNumber;
let formatProjectNumber;
let sectorPrefix;
let getNextSalesOrderCode;
let getNextPurchaseOrderCode;
let transactionsSupported = true;

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  Counter = require('../../models/config/counterModel');
  ({ getNextProjectNumber, formatProjectNumber, sectorPrefix } = require('../../services/project/projectNumberService'));
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

// ===================== Project Number (sector-based) =====================

test('sectorPrefix: first three LETTERS, uppercased, ignoring case/whitespace/punctuation', () => {
  assert.equal(sectorPrefix('Agriculture'), 'AGR');
  assert.equal(sectorPrefix('agriculture'), 'AGR');
  assert.equal(sectorPrefix('  Agriculture  '), 'AGR');
  assert.equal(sectorPrefix('AGRICULTURE'), 'AGR');
  assert.equal(sectorPrefix('Construction'), 'CON');
  assert.equal(sectorPrefix('Engineering'), 'ENG');
  assert.equal(sectorPrefix('Technology'), 'TEC');
});

test('sectorPrefix: handles sector names shorter than three letters safely (never throws)', () => {
  assert.equal(sectorPrefix('Ai'), 'AI');
  assert.equal(sectorPrefix('X'), 'X');
  assert.equal(sectorPrefix(''), '');
  assert.equal(sectorPrefix(null), '');
  assert.equal(sectorPrefix(undefined), '');
});

test('sectorPrefix: strips punctuation/digits/spaces, keeping only letters', () => {
  assert.equal(sectorPrefix('Oil & Gas'), 'OIL');
  assert.equal(sectorPrefix('3D Printing'), 'DPR');
});

test('getNextProjectNumber: first project in a sector gets 0000001, formatted as PREFIX-0000001', async () => {
  const first = await getNextProjectNumber('Agriculture');
  assert.equal(first, 'AGR-0000001');
  assert.equal(first, formatProjectNumber('AGR', 1));
});

test('getNextProjectNumber: subsequent projects in the SAME sector increment sequentially', async () => {
  assert.equal(await getNextProjectNumber('Construction'), 'CON-0000001');
  assert.equal(await getNextProjectNumber('Construction'), 'CON-0000002');
  assert.equal(await getNextProjectNumber('Construction'), 'CON-0000003');
});

test('getNextProjectNumber: different sectors are numbered independently, each starting at 0000001', async () => {
  assert.equal(await getNextProjectNumber('Agriculture'), 'AGR-0000001');
  assert.equal(await getNextProjectNumber('Construction'), 'CON-0000001');
  assert.equal(await getNextProjectNumber('Agriculture'), 'AGR-0000002');
  assert.equal(await getNextProjectNumber('Engineering'), 'ENG-0000001');
  assert.equal(await getNextProjectNumber('Construction'), 'CON-0000002');
  assert.equal(await getNextProjectNumber('Agriculture'), 'AGR-0000003');
});

test('getNextProjectNumber: case/whitespace variants of the same sector name share ONE sequence', async () => {
  assert.equal(await getNextProjectNumber('Technology'), 'TEC-0000001');
  assert.equal(await getNextProjectNumber('technology'), 'TEC-0000002');
  assert.equal(await getNextProjectNumber('  TECHNOLOGY  '), 'TEC-0000003');
});

test('getNextProjectNumber: a missing/empty sector name is rejected with a clear error, never silently numbered', async () => {
  await assert.rejects(() => getNextProjectNumber(''), /valid sector is required/i);
  await assert.rejects(() => getNextProjectNumber(null), /valid sector is required/i);
  await assert.rejects(() => getNextProjectNumber(undefined), /valid sector is required/i);
});

test('getNextProjectNumber: concurrent calls for the SAME sector never collide', async () => {
  const results = await Promise.all(Array.from({ length: 20 }, () => getNextProjectNumber('Industrials')));
  const unique = new Set(results);
  assert.equal(unique.size, 20, 'every concurrently-allocated project number for the same sector must be unique');
});

test('getNextProjectNumber: concurrent calls ACROSS different sectors never collide and each sector still gets a clean 1..N run', async () => {
  const sectors = ['Agriculture', 'Construction', 'Engineering', 'Technology'];
  const calls = [];
  for (let i = 0; i < 10; i++) {
    for (const sector of sectors) calls.push(getNextProjectNumber(sector).then(n => ({ sector, n })));
  }
  const results = await Promise.all(calls);
  const allNumbers = results.map(r => r.n);
  assert.equal(new Set(allNumbers).size, allNumbers.length, 'no two allocations across any sector may collide');
  for (const sector of sectors) {
    const prefix = sectorPrefix(sector);
    const seqs = results.filter(r => r.sector === sector).map(r => parseInt(r.n.split('-')[1], 10)).sort((a, b) => a - b);
    assert.deepEqual(seqs, Array.from({ length: 10 }, (_, i) => i + 1), `${prefix} must get a clean, gapless 1..10 run of its own`);
  }
});

test('getNextProjectNumber: range exhaustion throws a clean business error, without wrapping around, and only affects that one prefix', async () => {
  await Counter.create({ _id: 'projectNumber:AGR', seq: 1, min: 1, max: 2 });
  const first = await getNextProjectNumber('Agriculture');
  assert.equal(first, 'AGR-0000002');
  await assert.rejects(() => getNextProjectNumber('Agriculture'), /exhausted/i);
  // A different sector/prefix is entirely unaffected by Agriculture's exhausted range.
  assert.equal(await getNextProjectNumber('Construction'), 'CON-0000001');
});

test('getNextProjectNumber: two consecutive allocations inside the SAME transaction both succeed', async t => {
  if (!transactionsSupported) return t.skip('local MongoDB is a standalone instance, not a replica set - transactions unavailable (works against the real Atlas cluster)');

  const session = await mongoose.startSession();
  let first;
  let second;
  await session.withTransaction(async () => {
    first = await getNextProjectNumber('Villa', session);
    second = await getNextProjectNumber('Villa', session);
  });
  session.endSession();

  assert.notEqual(first, second);
});

// Compatibility: a pre-existing single 'projectNumber' counter (the earlier, non-sector-based
// implementation) is a DIFFERENT key from any 'projectNumber:<PREFIX>' key - the new per-prefix
// counters never read or write it, so no historical counter state collides with the new scheme.
test('getNextProjectNumber: never reads/writes the old single "projectNumber" counter key (no collision with the prior non-sector-based scheme)', async () => {
  await Counter.create({ _id: 'projectNumber', seq: 41, min: 1, max: 999999 });
  const first = await getNextProjectNumber('Villa');
  assert.equal(first, 'VIL-0000001', 'a brand-new prefix must start at 1 regardless of the old single counter\'s state');
  const oldCounter = await Counter.findById('projectNumber');
  assert.equal(oldCounter.seq, 41, 'the old counter key must be completely untouched');
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
