const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Mirrors customerNumberService.test.js - vendorNumber is the identical atomic-counter mechanism,
// shown as the vendor's "Sub Account" on journal-entry/general-ledger lines (docs section "Sub
// Account Mapping"). Vendor numbers start at 2000 (2000-2999).

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_vendor_numbers';

let getNextVendorNumber;
let RANGE_MIN;
let RANGE_MAX;
let Counter;
let Vendor;
let customerNumberService;

const isVendorRange = n => Number.isInteger(n) && n >= 2000 && n <= 2999;
const insertRawVendor = (vendorNumber, extra = {}) =>
  mongoose.connection.collection('vendors').insertOne({ name: `Raw ${vendorNumber}`, contact: { phone: `0100${vendorNumber}` }, vendorNumber, createdAt: new Date(), updatedAt: new Date(), ...extra });

const reset = async () => {
  await Counter.deleteMany({});
  await Vendor.deleteMany({});
};

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();

  Counter = require('../models/config/counterModel');
  Vendor = require('../models/vendor/vendor');
  ({ getNextVendorNumber, RANGE_MIN, RANGE_MAX } = require('../services/vendor/vendorNumberService'));
  customerNumberService = require('../services/customer/customerNumberService');
  await Vendor.init();
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

test('the vendor number range is 2000-2999', () => {
  assert.equal(RANGE_MIN, 2000);
  assert.equal(RANGE_MAX, 2999);
});

test('a fresh database issues 2000 first, then 2001, 2002', async () => {
  await reset();
  assert.equal(await getNextVendorNumber(), 2000);
  assert.equal(await getNextVendorNumber(), 2001);
  assert.equal(await getNextVendorNumber(), 2002);
});

test('issues sequential, unique numbers under concurrent calls (no lost/duplicate numbers)', async () => {
  await reset();

  const CONCURRENT_REQUESTS = 25;
  const numbers = await Promise.all(Array.from({ length: CONCURRENT_REQUESTS }, () => getNextVendorNumber()));

  assert.equal(new Set(numbers).size, CONCURRENT_REQUESTS, 'every concurrently-issued vendor number must be unique - a duplicate means the increment was not atomic');
  const sorted = [...numbers].sort((a, b) => a - b);
  assert.equal(sorted[0], 2000);
  for (let i = 1; i < sorted.length; i++) {
    assert.equal(sorted[i], sorted[i - 1] + 1, 'issued numbers must form a contiguous sequence with no gaps or reuse');
  }
});

test('concurrent vendor creation on a legacy counter migrates once and never duplicates', async () => {
  await reset();
  await Counter.create({ _id: 'vendorNumber', seq: 1042, min: 1000, max: 999999 });

  const vendors = await Promise.all(Array.from({ length: 15 }, (_, i) => Vendor.create({ name: `Concurrent Vendor ${String.fromCharCode(65 + i)}`, contact: { phone: `0111000${String(i).padStart(4, '0')}` } })));
  const numbers = vendors.map(v => v.vendorNumber).sort((a, b) => a - b);

  assert.equal(new Set(numbers).size, 15);
  assert.deepEqual(numbers, Array.from({ length: 15 }, (_, i) => 2000 + i));
});

test('a counter from the old 1000+ scheme restarts at 2000 (existing vendors untouched)', async () => {
  await reset();
  await Counter.create({ _id: 'vendorNumber', seq: 1042, min: 1000, max: 999999 });
  const legacy = await insertRawVendor(1042);

  assert.equal(await getNextVendorNumber(), 2000);

  const counter = await Counter.findById('vendorNumber');
  assert.equal(counter.min, 2000);
  assert.equal(counter.max, 2999);
  assert.equal((await Vendor.findById(legacy.insertedId)).vendorNumber, 1042, 'existing vendor numbers are never migrated');
});

test('a counter from the 20001-29999 scheme restarts at 2000 (existing 2xxxx vendors untouched)', async () => {
  await reset();
  await Counter.create({ _id: 'vendorNumber', seq: 20003, min: 20001, max: 29999 });
  const fiveDigit = await insertRawVendor(20003);

  assert.equal(await getNextVendorNumber(), 2000);
  assert.equal((await Vendor.findById(fiveDigit.insertedId)).vendorNumber, 20003);
});

test('continues from the highest existing vendor number >= 2000 (+1)', async () => {
  await reset();
  // Legacy 1000+ counter that had already reached past 2000 - vendors 2000..2041 exist.
  await Counter.create({ _id: 'vendorNumber', seq: 2041, min: 1000, max: 999999 });
  await insertRawVendor(1500);
  await insertRawVendor(2041);

  assert.equal(await getNextVendorNumber(), 2042);
});

test('never re-issues a number an existing vendor already holds, even if the counter is behind', async () => {
  await reset();
  await insertRawVendor(2050);
  assert.equal(await getNextVendorNumber(), 2051);

  await reset();
  await Counter.create({ _id: 'vendorNumber', seq: 2010, min: 2000, max: 2999 });
  await insertRawVendor(2075);
  assert.equal(await getNextVendorNumber(), 2076);
});

test('a counter already on the 2000 range survives a restart without moving backwards', async () => {
  await reset();
  // A number was issued but its vendor was never saved/was deleted - it must still not be reissued.
  await Counter.create({ _id: 'vendorNumber', seq: 2005, min: 2000, max: 2999 });
  assert.equal(await getNextVendorNumber(), 2006);
});

test('throws a clear business error once 2999 has been issued, without wrapping around', async () => {
  await reset();
  await Counter.create({ _id: 'vendorNumber', seq: 2998, min: 2000, max: 2999 });

  assert.equal(await getNextVendorNumber(), 2999);
  await assert.rejects(() => getNextVendorNumber(), /exhausted/i, 'must refuse to issue a number beyond 2999, not silently reuse an old one');
  assert.equal((await Counter.findById('vendorNumber')).seq, 2999);
});

test('creating a vendor auto-assigns 2000 and a client-supplied vendorNumber is ignored', async () => {
  await reset();

  const vendor = await Vendor.create({
    name: 'Test Vendor',
    contact: { phone: '01000000001' },
    vendorNumber: 999999999, // Client-supplied value must be ignored - see vendor.js's pre('save') hook.
  });
  assert.equal(vendor.vendorNumber, 2000);

  const secondVendor = await Vendor.create({ name: 'Second Vendor', contact: { phone: '01000000002' } });
  assert.equal(secondVendor.vendorNumber, 2001);
  assert.ok(isVendorRange(secondVendor.vendorNumber));
});

test('vendors created through insertMany (CSV import) get sequential vendor numbers too', async () => {
  await reset();
  await Vendor.create({ name: 'Created First', contact: { phone: '01000000011' } });

  const imported = await Vendor.insertMany([
    { name: 'Imported One', contact: { phone: '01000000012' }, vendorNumber: 5 },
    { name: 'Imported Two', contact: { phone: '01000000013' } },
  ]);

  assert.deepEqual(imported.map(v => v.vendorNumber), [2001, 2002]);
});

test('vendor numbering does not touch the customer number counter', async () => {
  await reset();
  await Counter.create({ _id: 'customerNumber', seq: 1010, min: 1000, max: 999999 });

  await getNextVendorNumber();

  const customerCounter = await Counter.findById('customerNumber');
  assert.equal(customerCounter.seq, 1010);
  assert.equal(customerCounter.min, 1000);
  assert.equal(await customerNumberService.getNextCustomerNumber(), 1011);
  assert.equal((await Counter.findById('vendorNumber')).seq, 2000);
});

test('vendorNumber is immutable after creation', async () => {
  await reset();
  const vendor = await Vendor.create({ name: 'Immutable Vendor', contact: { phone: '01000000003' } });
  const originalNumber = vendor.vendorNumber;

  vendor.vendorNumber = 123456;
  await vendor.save();

  const reloaded = await Vendor.findById(vendor._id);
  assert.equal(reloaded.vendorNumber, originalNumber, 'immutable: true must block any later change');
});
