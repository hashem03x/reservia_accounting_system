const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_customer_numbers';

let getNextCustomerNumber;
let Counter;
let User;

before(async () => {
  await mongoose.connect(DB_URI);
  // Start from a clean slate every run - this suite owns this disposable database exclusively.
  await mongoose.connection.dropDatabase();

  Counter = require('../models/config/counterModel');
  User = require('../models/userModel');
  ({ getNextCustomerNumber } = require('../services/customer/customerNumberService'));
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

test('issues sequential, unique numbers under concurrent calls (no lost/duplicate numbers)', async () => {
  await Counter.deleteMany({});

  const CONCURRENT_REQUESTS = 25;
  const numbers = await Promise.all(Array.from({ length: CONCURRENT_REQUESTS }, () => getNextCustomerNumber()));

  const uniqueNumbers = new Set(numbers);
  assert.equal(uniqueNumbers.size, CONCURRENT_REQUESTS, 'every concurrently-issued customer number must be unique - a duplicate means the increment was not atomic');

  const sorted = [...numbers].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    assert.equal(sorted[i], sorted[i - 1] + 1, 'issued numbers must form a contiguous sequence with no gaps or reuse');
  }
});

test('throws a clear business error once the configured range is exhausted, without wrapping around', async () => {
  await Counter.deleteMany({});
  // Seed a counter that's already one step away from its max.
  await Counter.create({ _id: 'customerNumber', seq: 4998, min: 1000, max: 5000 });

  const first = await getNextCustomerNumber();
  assert.equal(first, 4999);
  const second = await getNextCustomerNumber();
  assert.equal(second, 5000);

  await assert.rejects(() => getNextCustomerNumber(), /exhausted/i, 'must refuse to issue a number beyond max, not silently reuse an old one');

  // Confirm it really refused (didn't sneakily advance past max).
  const counter = await Counter.findById('customerNumber');
  assert.equal(counter.seq, 5000);
});

test('creating a customer (User with role "user") auto-assigns a unique customerNumber the client cannot override', async () => {
  await Counter.deleteMany({});
  await User.deleteMany({});

  const customer = await User.create({
    name: 'Test Customer',
    phone: '01000000001',
    role: 'user',
    type: 'offline',
    isOffline: true,
    customerNumber: 999999999, // Client-supplied value must be ignored - see userModel.js's pre('save') hook.
  });

  assert.notEqual(customer.customerNumber, 999999999);
  assert.equal(typeof customer.customerNumber, 'number');

  const secondCustomer = await User.create({
    name: 'Second Customer',
    phone: '01000000002',
    role: 'user',
    type: 'offline',
    isOffline: true,
  });
  assert.notEqual(secondCustomer.customerNumber, customer.customerNumber);
});

test('staff accounts (non-"user" roles) never receive a customerNumber', async () => {
  await User.deleteMany({ role: { $ne: 'user' } });

  const admin = await User.create({
    name: 'Test Admin',
    email: 'test-admin@example.com',
    role: 'admin',
    type: 'online',
  });

  assert.equal(admin.customerNumber, undefined);
});
