const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_bank_info';

let Vendor;
let User;

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  Vendor = require('../models/vendor/vendor');
  User = require('../models/userModel');
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  await Vendor.deleteMany({});
  await User.deleteMany({});
});

const VALID_EGYPTIAN_IBAN = 'EG380019000500000000263180002'; // 29 characters, starts with EG

test('accepts a valid Egyptian IBAN on a Vendor', async () => {
  const vendor = await Vendor.create({
    name: 'Test Vendor',
    contact: { phone: '01000000001' },
    bankInfo: { iban: VALID_EGYPTIAN_IBAN },
  });
  assert.equal(vendor.bankInfo.iban, VALID_EGYPTIAN_IBAN);
});

test('rejects an IBAN that does not start with "EG"', async () => {
  await assert.rejects(
    () => Vendor.create({ name: 'Test Vendor Two', contact: { phone: '01000000002' }, bankInfo: { iban: 'FR3800190005000000026318000' } }),
    /not a valid Egyptian IBAN/
  );
});

test('rejects an IBAN with the wrong total length', async () => {
  await assert.rejects(
    () => Vendor.create({ name: 'Test Vendor Three', contact: { phone: '01000000003' }, bankInfo: { iban: 'EG38001900050000' } }), // too short
    /not a valid Egyptian IBAN/
  );
  await assert.rejects(
    () => Vendor.create({ name: 'Test Vendor Four', contact: { phone: '01000000004' }, bankInfo: { iban: `${VALID_EGYPTIAN_IBAN}EXTRA` } }), // too long
    /not a valid Egyptian IBAN/
  );
});

test('rejects an IBAN containing non-alphanumeric characters', async () => {
  await assert.rejects(
    () => Vendor.create({ name: 'Test Vendor Five', contact: { phone: '01000000005' }, bankInfo: { iban: 'EG38-0019-0005-0000-0000-26318-0002' } }),
    /not a valid Egyptian IBAN/
  );
});

test('a lowercase IBAN is normalized to uppercase and still validated correctly', async () => {
  const vendor = await Vendor.create({
    name: 'Test Vendor Six',
    contact: { phone: '01000000006' },
    bankInfo: { iban: VALID_EGYPTIAN_IBAN.toLowerCase() },
  });
  assert.equal(vendor.bankInfo.iban, VALID_EGYPTIAN_IBAN);
});

test('bankInfo.iban is optional - no IBAN provided is valid', async () => {
  const vendor = await Vendor.create({ name: 'Test Vendor Seven', contact: { phone: '01000000007' } });
  assert.equal(vendor.bankInfo?.iban, undefined);
});

test('swiftCode saves correctly alongside other bank info, on both Vendor and Customer (User)', async () => {
  const vendor = await Vendor.create({
    name: 'Test Vendor Eight',
    contact: { phone: '01000000008' },
    bankInfo: { bankName: 'NBE', iban: VALID_EGYPTIAN_IBAN, swiftCode: 'NBEGEGCX123' },
  });
  assert.equal(vendor.bankInfo.swiftCode, 'NBEGEGCX123');

  const customer = await User.create({
    name: 'Test Customer',
    phone: '01000000009',
    role: 'user',
    type: 'offline',
    isOffline: true,
    bankInfo: { bankName: 'CIB', swiftCode: 'cibeegcx' },
  });
  assert.equal(customer.bankInfo.swiftCode, 'CIBEEGCX', 'swiftCode is normalized to uppercase');
});

test('rejects an invalid SWIFT/BIC code', async () => {
  await assert.rejects(
    () => Vendor.create({ name: 'Test Vendor Nine', contact: { phone: '01000000010' }, bankInfo: { swiftCode: 'TOO-SHORT' } }),
    /not a valid SWIFT\/BIC code/
  );
});
