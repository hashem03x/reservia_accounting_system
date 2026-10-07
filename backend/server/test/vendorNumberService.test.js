const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Mirrors customerNumberService.test.js - vendorNumber is the identical atomic-counter mechanism,
// shown as the vendor's "Sub Account" on journal-entry/general-ledger lines (docs section "Sub
// Account Mapping"). Vendor numbers are 5-digit numbers starting with 2 (20001-29999).

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_vendor_numbers';

let getNextVendorNumber;
let RANGE_MIN;
let RANGE_MAX;
let Counter;
let Vendor;

const isTwoXXXX = n => Number.isInteger(n) && /^2\d{4}$/.test(String(n));

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();

  Counter = require('../models/config/counterModel');
  Vendor = require('../models/vendor/vendor');
  ({ getNextVendorNumber, RANGE_MIN, RANGE_MAX } = require('../services/vendor/vendorNumberService'));
  await Vendor.init();
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

test('the vendor number range is exactly 20001-29999 (5 digits, always starting with 2)', () => {
  assert.equal(RANGE_MIN, 20001);
  assert.equal(RANGE_MAX, 29999);
});

test('a fresh counter issues 20001 first', async () => {
  await Counter.deleteMany({});
  await Vendor.deleteMany({});
  assert.equal(await getNextVendorNumber(), 20001);
});

test('issues sequential, unique 2xxxx numbers under concurrent calls (no lost/duplicate numbers)', async () => {
  await Counter.deleteMany({});
  await Vendor.deleteMany({});

  const CONCURRENT_REQUESTS = 25;
  const numbers = await Promise.all(Array.from({ length: CONCURRENT_REQUESTS }, () => getNextVendorNumber()));

  const uniqueNumbers = new Set(numbers);
  assert.equal(uniqueNumbers.size, CONCURRENT_REQUESTS, 'every concurrently-issued vendor number must be unique - a duplicate means the increment was not atomic');
  numbers.forEach(n => assert.ok(isTwoXXXX(n), `${n} must be a 5-digit number starting with 2`));

  const sorted = [...numbers].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    assert.equal(sorted[i], sorted[i - 1] + 1, 'issued numbers must form a contiguous sequence with no gaps or reuse');
  }
});

test('a counter left over from the old 1000+ scheme is moved into the 2xxxx range (existing vendors untouched)', async () => {
  await Counter.deleteMany({});
  await Vendor.deleteMany({});
  // Legacy state: the shared counter was at 1042 with the old 1000-999999 range, and a legacy vendor
  // already holds number 1042 (inserted raw, as it was created before this change).
  await Counter.create({ _id: 'vendorNumber', seq: 1042, min: 1000, max: 999999 });
  const legacyId = new mongoose.Types.ObjectId();
  await mongoose.connection.collection('vendors').insertOne({ _id: legacyId, name: 'Legacy Vendor', contact: { phone: '01000000099' }, vendorNumber: 1042, createdAt: new Date(), updatedAt: new Date() });

  const next = await getNextVendorNumber();
  assert.equal(next, 20001);

  const counter = await Counter.findById('vendorNumber');
  assert.equal(counter.min, 20001);
  assert.equal(counter.max, 29999);

  const legacy = await Vendor.findById(legacyId);
  assert.equal(legacy.vendorNumber, 1042, 'existing vendor numbers are never migrated');
});

test('never re-issues a 2xxxx number an existing vendor already holds, even if the counter is behind', async () => {
  await Counter.deleteMany({});
  await Vendor.deleteMany({});
  await mongoose.connection.collection('vendors').insertOne({ name: 'Already Numbered', contact: { phone: '01000000098' }, vendorNumber: 20050, createdAt: new Date(), updatedAt: new Date() });

  assert.equal(await getNextVendorNumber(), 20051);
});

test('throws a clear business error once 29999 has been issued, without wrapping around', async () => {
  await Counter.deleteMany({});
  await Vendor.deleteMany({});
  await Counter.create({ _id: 'vendorNumber', seq: 29998, min: 20001, max: 29999 });

  assert.equal(await getNextVendorNumber(), 29999);
  await assert.rejects(() => getNextVendorNumber(), /exhausted/i, 'must refuse to issue a number beyond 29999, not silently reuse an old one');

  const counter = await Counter.findById('vendorNumber');
  assert.equal(counter.seq, 29999);
});

test('creating a vendor auto-assigns a unique 2xxxx vendorNumber the client cannot override', async () => {
  await Counter.deleteMany({});
  await Vendor.deleteMany({});

  const vendor = await Vendor.create({
    name: 'Test Vendor',
    contact: { phone: '01000000001' },
    vendorNumber: 999999999, // Client-supplied value must be ignored - see vendor.js's pre('save') hook.
  });

  assert.notEqual(vendor.vendorNumber, 999999999);
  assert.ok(isTwoXXXX(vendor.vendorNumber));

  const secondVendor = await Vendor.create({ name: 'Second Vendor', contact: { phone: '01000000002' } });
  assert.ok(isTwoXXXX(secondVendor.vendorNumber));
  assert.notEqual(secondVendor.vendorNumber, vendor.vendorNumber);
});

test('vendorNumber is immutable after creation', async () => {
  await Vendor.deleteMany({});
  const vendor = await Vendor.create({ name: 'Immutable Vendor', contact: { phone: '01000000003' } });
  const originalNumber = vendor.vendorNumber;

  vendor.vendorNumber = 123456;
  await vendor.save();

  const reloaded = await Vendor.findById(vendor._id);
  assert.equal(reloaded.vendorNumber, originalNumber, 'immutable: true must block any later change');
});
