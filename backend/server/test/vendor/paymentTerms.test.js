const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const { validatePaymentTermsConfig, validateInstallmentsRequirePaymentTerms } = require('../../utils/paymentTermsConfig');
const { buildPaymentSchedule, round2 } = require('../../utils/helpers/paymentSchedule');

// ===================== Pure validation (no DB) =====================

test('validatePaymentTermsConfig: null/undefined is valid (no config supplied - default applies)', () => {
  assert.equal(validatePaymentTermsConfig(null), null);
  assert.equal(validatePaymentTermsConfig(undefined), null);
});

test('validatePaymentTermsConfig: a lump-sum immediate payment is valid with duration 0 or omitted', () => {
  assert.equal(validatePaymentTermsConfig({ kind: 'lump_sum', lumpSum: { timing: 'immediate' } }), null);
  assert.equal(validatePaymentTermsConfig({ kind: 'lump_sum', lumpSum: { timing: 'immediate', durationDays: 0 } }), null);
});

test('validatePaymentTermsConfig: an immediate lump-sum with a non-zero duration is rejected', () => {
  assert.match(validatePaymentTermsConfig({ kind: 'lump_sum', lumpSum: { timing: 'immediate', durationDays: 30 } }), /duration of zero/);
});

test('validatePaymentTermsConfig: a deferred lump-sum requires a positive whole number of days', () => {
  assert.equal(validatePaymentTermsConfig({ kind: 'lump_sum', lumpSum: { timing: 'deferred', durationDays: 30 } }), null);
  assert.match(validatePaymentTermsConfig({ kind: 'lump_sum', lumpSum: { timing: 'deferred', durationDays: 0 } }), /positive/);
  assert.match(validatePaymentTermsConfig({ kind: 'lump_sum', lumpSum: { timing: 'deferred' } }), /positive/);
  assert.match(validatePaymentTermsConfig({ kind: 'lump_sum', lumpSum: { timing: 'deferred', durationDays: 15.5 } }), /positive/);
});

test('validatePaymentTermsConfig: installments must sum to exactly 100% (within tolerance)', () => {
  const valid = {
    kind: 'installments',
    installments: [
      { durationDays: 30, percentage: 40 },
      { durationDays: 60, percentage: 35 },
      { durationDays: 90, percentage: 25 },
    ],
  };
  assert.equal(validatePaymentTermsConfig(valid), null);

  const invalid = { kind: 'installments', installments: [{ durationDays: 30, percentage: 40 }, { durationDays: 60, percentage: 50 }] };
  assert.match(validatePaymentTermsConfig(invalid), /sum to 100/);
});

test('validatePaymentTermsConfig: a tiny floating-point rounding difference within tolerance is accepted', () => {
  const config = {
    kind: 'installments',
    installments: [
      { durationDays: 30, percentage: 33.33 },
      { durationDays: 60, percentage: 33.33 },
      { durationDays: 90, percentage: 33.34 },
    ],
  };
  assert.equal(validatePaymentTermsConfig(config), null);
});

test('validatePaymentTermsConfig: every installment percentage must be greater than zero', () => {
  const config = { kind: 'installments', installments: [{ durationDays: 30, percentage: 0 }, { durationDays: 60, percentage: 100 }] };
  assert.match(validatePaymentTermsConfig(config), /greater than zero/);
});

test('validatePaymentTermsConfig: a negative or non-integer duration is rejected', () => {
  assert.match(validatePaymentTermsConfig({ kind: 'installments', installments: [{ durationDays: -5, percentage: 100 }] }), /non-negative whole number/);
  assert.match(validatePaymentTermsConfig({ kind: 'installments', installments: [{ durationDays: 5.5, percentage: 100 }] }), /non-negative whole number/);
});

test('validatePaymentTermsConfig: an empty installments array is rejected', () => {
  assert.match(validatePaymentTermsConfig({ kind: 'installments', installments: [] }), /at least one installment/);
});

test('validatePaymentTermsConfig: an unknown kind is rejected', () => {
  assert.match(validatePaymentTermsConfig({ kind: 'bogus' }), /lump_sum.*installments/);
});

// ===================== Cross-field: installments require payment terms (no DB) =====================

test('validateInstallmentsRequirePaymentTerms: lump-sum configs are never subject to the rule', () => {
  assert.equal(validateInstallmentsRequirePaymentTerms({ kind: 'lump_sum' }, undefined, undefined), null);
  assert.equal(validateInstallmentsRequirePaymentTerms(null, undefined, undefined), null);
});

test('validateInstallmentsRequirePaymentTerms: installments enabled with a valid Net term and no custom days needed', () => {
  assert.equal(validateInstallmentsRequirePaymentTerms({ kind: 'installments' }, 'Net 30', null), null);
  assert.equal(validateInstallmentsRequirePaymentTerms({ kind: 'installments' }, 'Immediate', null), null);
});

test('validateInstallmentsRequirePaymentTerms: installments enabled but payment terms missing is rejected', () => {
  assert.match(validateInstallmentsRequirePaymentTerms({ kind: 'installments' }, undefined, undefined), /Payment terms are required/);
  assert.match(validateInstallmentsRequirePaymentTerms({ kind: 'installments' }, '', undefined), /Payment terms are required/);
  assert.match(validateInstallmentsRequirePaymentTerms({ kind: 'installments' }, null, undefined), /Payment terms are required/);
});

test('validateInstallmentsRequirePaymentTerms: installments enabled with an invalid payment term value is rejected', () => {
  assert.match(validateInstallmentsRequirePaymentTerms({ kind: 'installments' }, 'Net 90', null), /Invalid payment term/);
});

test('validateInstallmentsRequirePaymentTerms: installments enabled with Custom terms still requires customPaymentDays', () => {
  assert.match(validateInstallmentsRequirePaymentTerms({ kind: 'installments' }, 'Custom', undefined), /customPaymentDays is required/);
  assert.match(validateInstallmentsRequirePaymentTerms({ kind: 'installments' }, 'Custom', null), /customPaymentDays is required/);
  assert.match(validateInstallmentsRequirePaymentTerms({ kind: 'installments' }, 'Custom', ''), /customPaymentDays is required/);
  assert.equal(validateInstallmentsRequirePaymentTerms({ kind: 'installments' }, 'Custom', 45), null);
});

// ===================== Pure schedule building (no DB) =====================

test('buildPaymentSchedule: no config (undefined) defaults to one immediate, full-amount row', () => {
  const rows = buildPaymentSchedule(undefined, '2026-01-01', 1000);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].durationDays, 0);
  assert.equal(rows[0].amount, 1000);
  assert.equal(rows[0].percentage, 100);
  assert.equal(rows[0].dueDate.toISOString().slice(0, 10), '2026-01-01');
});

test('buildPaymentSchedule: a deferred lump sum produces one row, due N days later, for the full amount', () => {
  const rows = buildPaymentSchedule({ kind: 'lump_sum', lumpSum: { timing: 'deferred', durationDays: 30 } }, '2026-01-01', 1000);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amount, 1000);
  assert.equal(rows[0].dueDate.toISOString().slice(0, 10), '2026-01-31');
});

test('buildPaymentSchedule: installments split the total exactly per percentage, each due on its own date', () => {
  const rows = buildPaymentSchedule(
    { kind: 'installments', installments: [{ durationDays: 30, percentage: 40 }, { durationDays: 60, percentage: 35 }, { durationDays: 90, percentage: 25 }] },
    '2026-01-01',
    1000,
  );
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(r => r.amount), [400, 350, 250]);
  assert.equal(rows.reduce((sum, r) => sum + r.amount, 0), 1000);
  assert.equal(rows[0].dueDate.toISOString().slice(0, 10), '2026-01-31');
  assert.equal(rows[2].dueDate.toISOString().slice(0, 10), '2026-04-01');
});

test('buildPaymentSchedule: rounding always reconciles exactly to the total - the last installment absorbs the remainder', () => {
  // 100 split 3 ways at 33.33/33.33/33.34% would naively round to 33.33+33.33+33.34 = 100.00 already,
  // so use a total/split combination that genuinely produces a rounding remainder:
  // 10.00 at 33.33% each (3 installments) = 3.333 -> rounds to 3.33 three times = 9.99, short by 0.01.
  const rows = buildPaymentSchedule(
    { kind: 'installments', installments: [{ durationDays: 10, percentage: 33.33 }, { durationDays: 20, percentage: 33.33 }, { durationDays: 30, percentage: 33.34 }] },
    '2026-01-01',
    10,
  );
  const total = round2(rows.reduce((sum, r) => sum + r.amount, 0));
  assert.equal(total, 10, 'the schedule must reconcile EXACTLY to the document total, never off by a rounding cent');
  // The remainder landed entirely on the last row, by design (documented in paymentSchedule.js).
  assert.equal(rows[0].amount, 3.33);
  assert.equal(rows[1].amount, 3.33);
});

// ===================== Vendor model integration =====================

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_vendor_payment_terms';

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

let seq = 0;
function vendorFields(overrides = {}) {
  seq += 1;
  return { name: 'Terms Vendor', contact: { phone: `010${Date.now()}${seq}`.slice(0, 11) }, ...overrides };
}

test('Vendor: a vendor with no paymentTermsConfig defaults to an immediate lump sum (no behavior change for existing vendors)', async () => {
  const vendor = await Vendor.create(vendorFields());
  assert.equal(vendor.paymentTermsConfig.kind, 'lump_sum');
  assert.equal(vendor.paymentTermsConfig.lumpSum.timing, 'immediate');
});

test('Vendor: a valid installment configuration is saved', async () => {
  const vendor = await Vendor.create(
    vendorFields({
      paymentTermsConfig: {
        kind: 'installments',
        installments: [{ durationDays: 30, percentage: 40 }, { durationDays: 60, percentage: 35 }, { durationDays: 90, percentage: 25 }],
      },
    }),
  );
  assert.equal(vendor.paymentTermsConfig.installments.length, 3);
});

test('Vendor: an installment configuration that does not sum to 100% is rejected at save time (model backstop)', async () => {
  await assert.rejects(
    () => Vendor.create(vendorFields({ paymentTermsConfig: { kind: 'installments', installments: [{ durationDays: 30, percentage: 40 }, { durationDays: 60, percentage: 50 }] } })),
    /sum to 100/,
  );
});

test('Vendor: re-saving a vendor for an unrelated reason never re-validates an untouched paymentTermsConfig', async () => {
  const vendor = await Vendor.create(vendorFields());
  // Directly write an "invalid" config straight to the collection, bypassing Mongoose validation,
  // to simulate a legacy/pre-existing document - re-saving it for something unrelated (isActive)
  // must not suddenly start failing because of a field it never touched.
  await mongoose.connection.collection('vendors').updateOne({ _id: vendor._id }, { $set: { paymentTermsConfig: { kind: 'installments', installments: [{ durationDays: 1, percentage: 1 }] } } });
  const reloaded = await Vendor.findById(vendor._id);
  reloaded.isActive = false;
  await reloaded.save();
  assert.equal(reloaded.isActive, false);
});

test('Vendor: enabling installments with the default payment terms (Net 30) is saved without error', async () => {
  const vendor = await Vendor.create(
    vendorFields({ paymentTermsConfig: { kind: 'installments', installments: [{ durationDays: 30, percentage: 100 }] } }),
  );
  assert.equal(vendor.paymentTerms, 'Net 30');
  assert.equal(vendor.paymentTermsConfig.kind, 'installments');
});

test('Vendor: enabling installments with Custom payment terms but no customPaymentDays is rejected at save time (model backstop)', async () => {
  await assert.rejects(
    () =>
      Vendor.create(
        vendorFields({
          paymentTerms: 'Custom',
          paymentTermsConfig: { kind: 'installments', installments: [{ durationDays: 30, percentage: 100 }] },
        }),
      ),
    /customPaymentDays is required/,
  );
});

test('Vendor: enabling installments with Custom payment terms and a valid customPaymentDays is saved', async () => {
  const vendor = await Vendor.create(
    vendorFields({
      paymentTerms: 'Custom',
      customPaymentDays: 45,
      paymentTermsConfig: { kind: 'installments', installments: [{ durationDays: 30, percentage: 100 }] },
    }),
  );
  assert.equal(vendor.customPaymentDays, 45);
});
