const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Mirrors customerNumberService.test.js exactly - vendorNumber is the identical mechanism, added
// so journal-entry/general-ledger "Sub Account" display can show a real Vendor Number (docs
// section "Sub Account Mapping").

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_vendor_numbers';

let getNextVendorNumber;
let Counter;
let Vendor;

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();

  Counter = require('../models/config/counterModel');
  Vendor = require('../models/vendor/vendor');
  ({ getNextVendorNumber } = require('../services/vendor/vendorNumberService'));
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

test('issues sequential, unique numbers under concurrent calls (no lost/duplicate numbers)', async () => {
  await Counter.deleteMany({});

  const CONCURRENT_REQUESTS = 25;
  const numbers = await Promise.all(Array.from({ length: CONCURRENT_REQUESTS }, () => getNextVendorNumber()));

  const uniqueNumbers = new Set(numbers);
  assert.equal(uniqueNumbers.size, CONCURRENT_REQUESTS, 'every concurrently-issued vendor number must be unique - a duplicate means the increment was not atomic');

  const sorted = [...numbers].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    assert.equal(sorted[i], sorted[i - 1] + 1, 'issued numbers must form a contiguous sequence with no gaps or reuse');
  }
});

test('throws a clear business error once the configured range is exhausted, without wrapping around', async () => {
  await Counter.deleteMany({});
  await Counter.create({ _id: 'vendorNumber', seq: 4998, min: 1000, max: 5000 });

  const first = await getNextVendorNumber();
  assert.equal(first, 4999);
  const second = await getNextVendorNumber();
  assert.equal(second, 5000);

  await assert.rejects(() => getNextVendorNumber(), /exhausted/i, 'must refuse to issue a number beyond max, not silently reuse an old one');

  const counter = await Counter.findById('vendorNumber');
  assert.equal(counter.seq, 5000);
});

test('creating a vendor auto-assigns a unique vendorNumber the client cannot override', async () => {
  await Counter.deleteMany({});
  await Vendor.deleteMany({});

  const vendor = await Vendor.create({
    name: 'Test Vendor',
    contact: { phone: '01000000001' },
    vendorNumber: 999999999, // Client-supplied value must be ignored - see vendor.js's pre('save') hook.
  });

  assert.notEqual(vendor.vendorNumber, 999999999);
  assert.equal(typeof vendor.vendorNumber, 'number');

  const secondVendor = await Vendor.create({ name: 'Second Vendor', contact: { phone: '01000000002' } });
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
