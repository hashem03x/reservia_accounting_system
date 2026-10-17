const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { validationResult } = require('express-validator');

// Covers Phase 2's "Mandatory Vendor and Customer Contact Information" (docs section) at the
// validator layer - the layer that actually enforces the rule for both the manual create/edit
// forms and any direct API call. Deliberately exercises the SAME validator chains the real routes
// use (createCustomerValidate/updateCustomerValidate, createVendorValidators/
// updateVendorValidators), the same technique journalEntry.test.js uses for
// createJournalEntryValidators, rather than going through an HTTP+supertest layer.

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_contact_info_validation';

let User;
let Vendor;

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  User = require('../../models/userModel');
  Vendor = require('../../models/vendor/vendor');
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  await User.deleteMany({});
  await Vendor.deleteMany({});
});

async function runValidators(validators, body, params = {}) {
  const req = { body, params, query: {} };
  for (const middleware of validators) {
    if (typeof middleware.run === 'function') await middleware.run(req);
  }
  return validationResult(req);
}

// ===================== Customer =====================

test('createCustomerValidate: rejects a new customer with no email (email is now mandatory)', async () => {
  const { createCustomerValidate } = require('../../utils/validators/customerValidator');
  const result = await runValidators(createCustomerValidate, { name: 'Ahmed', contact: { phone: '01012345678' } });
  assert.equal(result.isEmpty(), false);
  assert.ok(result.array().some(e => /Email is required/.test(e.msg)));
});

test('createCustomerValidate: rejects a new customer with no phone', async () => {
  const { createCustomerValidate } = require('../../utils/validators/customerValidator');
  const result = await runValidators(createCustomerValidate, { name: 'Ahmed', contact: { email: 'ahmed@example.com' } });
  assert.equal(result.isEmpty(), false);
  assert.ok(result.array().some(e => /Phone number is required/.test(e.msg)));
});

test('createCustomerValidate: rejects an invalid phone format (neither Egyptian nor international)', async () => {
  const { createCustomerValidate } = require('../../utils/validators/customerValidator');
  const result = await runValidators(createCustomerValidate, { name: 'Ahmed', contact: { phone: '123', email: 'ahmed@example.com' } });
  assert.equal(result.isEmpty(), false);
  assert.ok(result.array().some(e => /valid Egyptian or international phone number/.test(e.msg)));
});

test('createCustomerValidate: accepts a valid Egyptian mobile and a valid international number', async () => {
  const { createCustomerValidate } = require('../../utils/validators/customerValidator');
  const egyptian = await runValidators(createCustomerValidate, { name: 'Ahmed', contact: { phone: '01012345678', email: 'ahmed1@example.com' } });
  assert.equal(egyptian.isEmpty(), true, JSON.stringify(egyptian.array()));

  const international = await runValidators(createCustomerValidate, { name: 'John', contact: { phone: '+14155552671', email: 'john@example.com' } });
  assert.equal(international.isEmpty(), true, JSON.stringify(international.array()));
});

test('createCustomerValidate: rejects an invalid email format', async () => {
  const { createCustomerValidate } = require('../../utils/validators/customerValidator');
  const result = await runValidators(createCustomerValidate, { name: 'Ahmed', contact: { phone: '01012345678', email: 'not-an-email' } });
  assert.equal(result.isEmpty(), false);
  assert.ok(result.array().some(e => /valid email/.test(e.msg)));
});

test('updateCustomerValidate: a legacy customer missing email/phone can still be edited without backfilling them (never force-retroactive)', async () => {
  const { updateCustomerValidate } = require('../../utils/validators/customerValidator');
  const legacy = await mongoose.connection.collection('users').insertOne({ name: 'Legacy Customer', role: 'user', type: 'offline', createdAt: new Date() });
  // Editing only `name` - contact fields are simply absent from the request body.
  const result = await runValidators(updateCustomerValidate, { name: 'Legacy Customer Updated' }, { id: legacy.insertedId.toString() });
  assert.equal(result.isEmpty(), true, JSON.stringify(result.array()));
});

test('updateCustomerValidate: still rejects a malformed phone/email WHEN one is actually provided', async () => {
  const { updateCustomerValidate } = require('../../utils/validators/customerValidator');
  const result = await runValidators(updateCustomerValidate, { contact: { phone: 'abc', email: 'not-an-email' } }, { id: new mongoose.Types.ObjectId().toString() });
  assert.equal(result.isEmpty(), false);
});

// ===================== Vendor =====================

test('createVendorValidators: rejects a new vendor with no email', async () => {
  const { createVendorValidators } = require('../../utils/validators/vendorValidators');
  const result = await runValidators(createVendorValidators, { name: 'Acme Supplies', contact: { phone: '01012345678' } });
  assert.equal(result.isEmpty(), false);
  assert.ok(result.array().some(e => /Email is required/.test(e.msg)));
});

test('createVendorValidators: rejects a new vendor with no phone', async () => {
  const { createVendorValidators } = require('../../utils/validators/vendorValidators');
  const result = await runValidators(createVendorValidators, { name: 'Acme Supplies', contact: { email: 'acme@example.com' } });
  assert.equal(result.isEmpty(), false);
  assert.ok(result.array().some(e => /Phone number is required/.test(e.msg)));
});

test('createVendorValidators: accepts a valid Egyptian mobile and a valid international phone number', async () => {
  const { createVendorValidators } = require('../../utils/validators/vendorValidators');
  const egyptian = await runValidators(createVendorValidators, { name: 'Acme Supplies', contact: { phone: '01112345678', email: 'acme1@example.com' } });
  assert.equal(egyptian.isEmpty(), true, JSON.stringify(egyptian.array()));

  const international = await runValidators(createVendorValidators, { name: 'Global Supplies', contact: { phone: '+442071838750', email: 'global@example.com' } });
  assert.equal(international.isEmpty(), true, JSON.stringify(international.array()));
});

// Regression for the real bug found in updateVendorValidators: it used to check top-level
// `email`/`phone` instead of the actual nested `contact.email`/`contact.phone` the request/
// factory.updateOne($set: req.body) path actually uses, making the check permanently dead code.
test('updateVendorValidators: validates the ACTUAL nested contact.email/contact.phone fields (regression for the dead top-level-field bug)', async () => {
  const { updateVendorValidators } = require('../../utils/validators/vendorValidators');
  const result = await runValidators(updateVendorValidators, { contact: { email: 'not-an-email', phone: 'xyz' } }, {});
  assert.equal(result.isEmpty(), false, 'a malformed nested contact.email/contact.phone must now actually be caught');
  assert.ok(result.array().some(e => /valid email/i.test(e.msg)));
  assert.ok(result.array().some(e => /valid Egyptian or international phone number/.test(e.msg)));
});

test('updateVendorValidators: a legacy vendor missing contact info can still be edited without backfilling it', async () => {
  const { updateVendorValidators } = require('../../utils/validators/vendorValidators');
  const result = await runValidators(updateVendorValidators, { name: 'Renamed Vendor' }, {});
  assert.equal(result.isEmpty(), true, JSON.stringify(result.array()));
});

// ===================== Shared phone helper =====================

// ===================== Import validation =====================
// (customerImportSchema.js/vendorImportSchema.js - replacing the previous insertMany-based
// importCustomerValidator.js/importVendorsValidator.js, which never assigned a customerNumber and
// dropped several real fields - see each schema file's header comment.)

const emptyContext = { existingPhones: new Set(), existingEmails: new Set() };

test('customerImportSchema#validateRow: requires email (same rule as the manual create form)', async () => {
  const { validateRow } = require('../../utils/validators/import/customerImportSchema');
  const { errors } = await validateRow({ Name: 'Ahmed', Phone: '01012345678' }, emptyContext);
  assert.ok(errors.some(e => e.column === 'Email' && /required/i.test(e.message)));
});

test('customerImportSchema#validateRow: a fully valid row has no errors and produces a creatable value', async () => {
  const { validateRow } = require('../../utils/validators/import/customerImportSchema');
  const { errors, value } = await validateRow({ Name: 'Ahmed', Phone: '01012345678', Email: 'ahmed@example.com' }, emptyContext);
  assert.deepEqual(errors, []);
  assert.equal(value.name, 'Ahmed');
  assert.equal(value.phone, '01012345678');
  assert.equal(value.email, 'ahmed@example.com');
});

test('vendorImportSchema#validateRow: rejects an invalid phone using the shared helper (accepts international, not just Egyptian)', async () => {
  const { validateRow } = require('../../utils/validators/import/vendorImportSchema');
  const { errors: invalid } = await validateRow(
    { Name: 'Acme', Email: 'acme@example.com', Phone: '123', Type: 'current', Street: 'x', City: 'x', State: 'x', Country: 'x' },
    emptyContext,
  );
  assert.ok(invalid.some(e => e.column === 'Phone' && /valid Egyptian or international phone number/.test(e.message)));

  const { errors: international } = await validateRow(
    { Name: 'Acme', Email: 'acme@example.com', Phone: '+442071838750', Type: 'current', Street: 'x', City: 'x', State: 'x', Country: 'x' },
    emptyContext,
  );
  assert.equal(international.length, 0, JSON.stringify(international));
});

test('isValidPhone: accepts every Egyptian mobile prefix in local and +20/0020/20 forms, rejects clearly invalid input', async () => {
  const { isValidPhone } = require('../../utils/validators/phoneValidator');
  for (const prefix of ['010', '011', '012', '015']) {
    const local = `${prefix}12345678`;
    assert.equal(isValidPhone(local), true, `${local} should be valid`);
    assert.equal(isValidPhone(`+20${prefix.slice(1)}12345678`), true);
  }
  assert.equal(isValidPhone(''), false);
  assert.equal(isValidPhone('12345'), false);
  assert.equal(isValidPhone('01312345678'), false, '013 is not a real Egyptian mobile prefix');
  // A generic international number must still pass.
  assert.equal(isValidPhone('+14155552671'), true);
});
