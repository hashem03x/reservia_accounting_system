const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { validationResult } = require('express-validator');

// Covers Phase 2's "Vendor Payment Information" (docs section) - the new structured `paymentInfo`
// field (Instapay / Wallet / Bank Details, exactly one mode at a time) added alongside the
// existing `bankInfo` field, which is never deleted or renamed (docs section "Preserve existing
// vendor bank data during migration").

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_vendor_payment_info';

let Vendor;

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  Vendor = require('../../models/vendor/vendor');
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  await Vendor.deleteMany({});
});

function baseVendor(overrides = {}) {
  return {
    name: 'Acme Supplies',
    contact: { phone: `010${Math.floor(10000000 + Math.random() * 89999999)}`, email: `acme${Date.now()}${Math.random()}@example.com` },
    ...overrides,
  };
}

async function runValidators(validators, body) {
  const req = { body, params: {}, query: {} };
  for (const middleware of validators) {
    if (typeof middleware.run === 'function') await middleware.run(req);
  }
  return validationResult(req);
}

// ===================== Model-level storage =====================

test('Vendor model: persists paymentInfo for each of the three modes, independently of bankInfo', async () => {
  const instapayVendor = await Vendor.create(baseVendor({ paymentInfo: { mode: 'instapay', instapay: { identifier: '01099998888' } } }));
  assert.equal(instapayVendor.paymentInfo.mode, 'instapay');
  assert.equal(instapayVendor.paymentInfo.instapay.identifier, '01099998888');

  const walletVendor = await Vendor.create(baseVendor({ paymentInfo: { mode: 'wallet', wallet: { provider: 'vodafone_cash', identifier: '01099997777' } } }));
  assert.equal(walletVendor.paymentInfo.mode, 'wallet');
  assert.equal(walletVendor.paymentInfo.wallet.provider, 'vodafone_cash');

  const bankVendor = await Vendor.create(
    baseVendor({ paymentInfo: { mode: 'bank', bank: { bankName: 'NBE', accountHolderName: 'Acme', accountNumber: '123456' } } })
  );
  assert.equal(bankVendor.paymentInfo.mode, 'bank');
  assert.equal(bankVendor.paymentInfo.bank.bankName, 'NBE');
});

test('Vendor model: an existing vendor\'s legacy bankInfo is untouched by setting paymentInfo (both can coexist)', async () => {
  const vendor = await Vendor.create(baseVendor({ bankInfo: { bankName: 'Legacy Bank', accountNumber: '999' } }));
  vendor.paymentInfo = { mode: 'instapay', instapay: { identifier: '01099998888' } };
  await vendor.save();

  const reloaded = await Vendor.findById(vendor._id);
  assert.equal(reloaded.bankInfo.bankName, 'Legacy Bank', 'bankInfo must never be deleted/overwritten by setting paymentInfo');
  assert.equal(reloaded.paymentInfo.mode, 'instapay');
});

test('Vendor model: rejects an invalid wallet provider / payment mode', async () => {
  await assert.rejects(() => Vendor.create(baseVendor({ paymentInfo: { mode: 'not-a-mode' } })));
  await assert.rejects(() => Vendor.create(baseVendor({ paymentInfo: { mode: 'wallet', wallet: { provider: 'not-a-provider' } } })));
});

// ===================== Validator-level: conditional required fields =====================

test('createVendorValidators: rejects Instapay mode with no identifier', async () => {
  const { createVendorValidators } = require('../../utils/validators/vendorValidators');
  const result = await runValidators(createVendorValidators, baseVendor({ paymentInfo: { mode: 'instapay' } }));
  assert.equal(result.isEmpty(), false);
  assert.ok(result.array().some(e => /Instapay identifier is required/.test(e.msg)));
});

test('createVendorValidators: rejects Wallet mode with a provider but no identifier', async () => {
  const { createVendorValidators } = require('../../utils/validators/vendorValidators');
  const result = await runValidators(createVendorValidators, baseVendor({ paymentInfo: { mode: 'wallet', wallet: { provider: 'fawry' } } }));
  assert.equal(result.isEmpty(), false);
  assert.ok(result.array().some(e => /Wallet provider and identifier are both required/.test(e.msg)));
});

test('createVendorValidators: rejects Bank Details mode with no account number', async () => {
  const { createVendorValidators } = require('../../utils/validators/vendorValidators');
  const result = await runValidators(createVendorValidators, baseVendor({ paymentInfo: { mode: 'bank', bank: { bankName: 'NBE' } } }));
  assert.equal(result.isEmpty(), false);
  assert.ok(result.array().some(e => /Bank name and account number are both required/.test(e.msg)));
});

test('createVendorValidators: accepts a fully completed mode for each of the three options', async () => {
  const { createVendorValidators } = require('../../utils/validators/vendorValidators');

  const instapay = await runValidators(createVendorValidators, baseVendor({ paymentInfo: { mode: 'instapay', instapay: { identifier: '01099998888' } } }));
  assert.equal(instapay.isEmpty(), true, JSON.stringify(instapay.array()));

  const wallet = await runValidators(
    createVendorValidators,
    baseVendor({ paymentInfo: { mode: 'wallet', wallet: { provider: 'orange_cash', identifier: '01299997777' } } })
  );
  assert.equal(wallet.isEmpty(), true, JSON.stringify(wallet.array()));

  const bank = await runValidators(
    createVendorValidators,
    baseVendor({ paymentInfo: { mode: 'bank', bank: { bankName: 'NBE', accountNumber: '123456' } } })
  );
  assert.equal(bank.isEmpty(), true, JSON.stringify(bank.array()));
});

test('createVendorValidators: paymentInfo is entirely optional - omitting it is valid', async () => {
  const { createVendorValidators } = require('../../utils/validators/vendorValidators');
  const result = await runValidators(createVendorValidators, baseVendor());
  assert.equal(result.isEmpty(), true, JSON.stringify(result.array()));
});

test('updateVendorValidators: an incomplete paymentInfo is still rejected on update (the conditional rule applies either way)', async () => {
  const { updateVendorValidators } = require('../../utils/validators/vendorValidators');
  const result = await runValidators(updateVendorValidators, { paymentInfo: { mode: 'bank', bank: {} } });
  assert.equal(result.isEmpty(), false);
});
