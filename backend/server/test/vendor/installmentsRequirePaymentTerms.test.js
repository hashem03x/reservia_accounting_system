const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { validationResult } = require('express-validator');

// Covers the validator-layer enforcement of "installments enabled => payment terms mandatory"
// (backend/server/utils/paymentTermsConfig.js#validateInstallmentsRequirePaymentTerms), exercised
// through the SAME validator chains the real vendor routes use
// (createVendorValidators/updateVendorValidators) - same technique as
// test/user/contactInfoValidation.test.js - rather than a full HTTP+supertest layer. This is the
// layer that actually enforces the rule on update, since factory.updateOne (handlersFactory.js)
// uses findByIdAndUpdate without runValidators, so the Mongoose schema/pre-save backstop alone
// never runs on a PUT request.

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_installments_require_terms';

let Vendor;

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  Vendor = require('../../models/vendor/vendor');
  await Vendor.init();
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  await Vendor.deleteMany({});
});

async function runValidators(validators, body, params = {}) {
  const req = { body, params, query: {} };
  for (const middleware of validators) {
    if (typeof middleware.run === 'function') await middleware.run(req);
  }
  return validationResult(req);
}

let seq = 0;
function vendorFields(overrides = {}) {
  seq += 1;
  return { name: 'Terms Vendor', contact: { phone: `010${Date.now()}${seq}`.slice(0, 11), email: `terms-vendor-${seq}@example.com` }, ...overrides };
}

// ===================== Create =====================

test('createVendorValidators: installments enabled with no paymentTerms sent passes (schema default "Net 30" applies)', async () => {
  const { createVendorValidators } = require('../../utils/validators/vendorValidators');
  const result = await runValidators(
    createVendorValidators,
    vendorFields({ paymentTermsConfig: { kind: 'installments', installments: [{ durationDays: 30, percentage: 100 }] } }),
  );
  assert.equal(result.isEmpty(), true, JSON.stringify(result.array()));
});

test('createVendorValidators: installments enabled with an explicitly empty paymentTerms is rejected', async () => {
  const { createVendorValidators } = require('../../utils/validators/vendorValidators');
  const result = await runValidators(
    createVendorValidators,
    vendorFields({ paymentTerms: '', paymentTermsConfig: { kind: 'installments', installments: [{ durationDays: 30, percentage: 100 }] } }),
  );
  assert.equal(result.isEmpty(), false);
  assert.ok(result.array().some(e => /Payment terms are required|Invalid payment term/.test(e.msg)), JSON.stringify(result.array()));
});

test('createVendorValidators: installments enabled with Custom terms but no customPaymentDays is rejected', async () => {
  const { createVendorValidators } = require('../../utils/validators/vendorValidators');
  const result = await runValidators(
    createVendorValidators,
    vendorFields({ paymentTerms: 'Custom', paymentTermsConfig: { kind: 'installments', installments: [{ durationDays: 30, percentage: 100 }] } }),
  );
  assert.equal(result.isEmpty(), false);
  assert.ok(result.array().some(e => /customPaymentDays is required/.test(e.msg)), JSON.stringify(result.array()));
});

test('createVendorValidators: installments enabled with Custom terms and a valid customPaymentDays passes', async () => {
  const { createVendorValidators } = require('../../utils/validators/vendorValidators');
  const result = await runValidators(
    createVendorValidators,
    vendorFields({
      paymentTerms: 'Custom',
      customPaymentDays: 45,
      paymentTermsConfig: { kind: 'installments', installments: [{ durationDays: 45, percentage: 100 }] },
    }),
  );
  assert.equal(result.isEmpty(), true, JSON.stringify(result.array()));
});

test('createVendorValidators: installments disabled (lump sum) never requires anything new, even with no paymentTerms sent', async () => {
  const { createVendorValidators } = require('../../utils/validators/vendorValidators');
  const result = await runValidators(createVendorValidators, vendorFields());
  assert.equal(result.isEmpty(), true, JSON.stringify(result.array()));
});

// ===================== Update =====================

test('updateVendorValidators: enabling installments via PATCH without re-sending paymentTerms is judged against the vendor\'s existing (valid) stored value', async () => {
  const vendor = await Vendor.create(vendorFields({ paymentTerms: 'Net 30' }));
  const { updateVendorValidators } = require('../../utils/validators/vendorValidators');
  const result = await runValidators(
    updateVendorValidators,
    { paymentTermsConfig: { kind: 'installments', installments: [{ durationDays: 30, percentage: 100 }] } },
    { id: vendor._id.toString() },
  );
  assert.equal(result.isEmpty(), true, JSON.stringify(result.array()));
});

test('updateVendorValidators: enabling installments via PATCH on a vendor whose stored Custom terms are missing customPaymentDays is rejected', async () => {
  // Simulate a legacy/inconsistent record bypassing application-level validation entirely, the
  // same technique paymentTerms.test.js uses to simulate a pre-existing document.
  const vendor = await Vendor.create(vendorFields({ paymentTerms: 'Net 30' }));
  await mongoose.connection.collection('vendors').updateOne({ _id: vendor._id }, { $set: { paymentTerms: 'Custom', customPaymentDays: null } });

  const { updateVendorValidators } = require('../../utils/validators/vendorValidators');
  const result = await runValidators(
    updateVendorValidators,
    { paymentTermsConfig: { kind: 'installments', installments: [{ durationDays: 30, percentage: 100 }] } },
    { id: vendor._id.toString() },
  );
  assert.equal(result.isEmpty(), false);
  assert.ok(result.array().some(e => /customPaymentDays is required/.test(e.msg)), JSON.stringify(result.array()));
});

test('updateVendorValidators: an update that never touches paymentTerms/customPaymentDays/paymentTermsConfig is never re-validated against this rule', async () => {
  // Same legacy/inconsistent vendor as above, but this PATCH only renames the vendor - it must not
  // suddenly start failing because of an unrelated field it isn't changing.
  const vendor = await Vendor.create(vendorFields({ paymentTerms: 'Net 30' }));
  await mongoose.connection.collection('vendors').updateOne(
    { _id: vendor._id },
    { $set: { paymentTerms: 'Custom', customPaymentDays: null, paymentTermsConfig: { kind: 'installments', installments: [{ durationDays: 1, percentage: 100 }] } } },
  );

  const { updateVendorValidators } = require('../../utils/validators/vendorValidators');
  const result = await runValidators(updateVendorValidators, { name: 'Renamed Vendor' }, { id: vendor._id.toString() });
  assert.equal(result.isEmpty(), true, JSON.stringify(result.array()));
});

test('updateVendorValidators: switching an installments vendor back to lump_sum never requires payment terms', async () => {
  const vendor = await Vendor.create(
    vendorFields({ paymentTermsConfig: { kind: 'installments', installments: [{ durationDays: 30, percentage: 100 }] } }),
  );
  const { updateVendorValidators } = require('../../utils/validators/vendorValidators');
  const result = await runValidators(
    updateVendorValidators,
    { paymentTermsConfig: { kind: 'lump_sum', lumpSum: { timing: 'immediate', durationDays: 0 } } },
    { id: vendor._id.toString() },
  );
  assert.equal(result.isEmpty(), true, JSON.stringify(result.array()));
});
