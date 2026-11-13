const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// ERP Modification Request (12 Nov 2026): company settings (CHG-03/06/07 controls, audited) and the
// CHG-07 price variance warning at PO entry ("same product bought at 6.7 and at 51, no warning").
const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_price_variance';

let Requisition, settings, checkPriceVariance;
const productId = new mongoose.Types.ObjectId();
const otherProduct = new mongoose.Types.ObjectId();

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  Requisition = require('../../models/vendor/requisitionModel');
  settings = require('../../services/config/companySettingsService');
  ({ checkPriceVariance } = require('../../services/vendor/priceVarianceService'));
  // Raw inserts: only the fields the price check reads (the PO model's own rules are tested elsewhere).
  const po = (code, at, items, status = 'open') => ({ code, status, createdAt: new Date(at), issueDate: new Date(at), items });
  await Requisition.collection.insertMany([
    po('000000000008', '2026-10-20', [{ product: productId, quantity: 1000, unitPrice: 6.7 }]),
    po('000000000009', '2026-10-22', [{ product: otherProduct, quantity: 5, unitPrice: 99 }]),
    po('000000000011', '2026-10-25', [{ product: productId, quantity: 10, unitPrice: 500 }], 'cancelled'),
  ]);
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

test('company settings: documented defaults before anything is saved', async () => {
  assert.deepEqual(await settings.getCompanySettings(), { vatDefaultPct: 14, priceVarianceWarnPct: 20, preventNegativeProjectStock: true });
});

test('company settings: validated, and every change is recorded with who made it', async () => {
  await assert.rejects(() => settings.updateCompanySettings({ vatDefaultPct: 120 }, null), /between 0 and 100/);
  await assert.rejects(() => settings.updateCompanySettings({ preventNegativeProjectStock: 'yes' }, null), /true or false/);
  await assert.rejects(() => settings.updateCompanySettings({ unknown: 1 }, null), /Nothing to change/);
  const user = { _id: new mongoose.Types.ObjectId(), name: 'Finance Admin' };
  const out = await settings.updateCompanySettings({ priceVarianceWarnPct: 30 }, user);
  assert.equal(out.priceVarianceWarnPct, 30);
  assert.equal(out.vatDefaultPct, 14, 'untouched fields keep their default');
  assert.equal(out.history[0].byName, 'Finance Admin');
  assert.deepEqual(out.history[0].changes, { priceVarianceWarnPct: { from: 20, to: 30 } });
  // Saving the same value again records nothing.
  assert.equal((await settings.updateCompanySettings({ priceVarianceWarnPct: 30 }, user)).history.length, 1);
  await settings.updateCompanySettings({ priceVarianceWarnPct: 20 }, user);
});

test('CHG-07: a PO at 51 for a product last bought at 6.7 warns; cancelled POs and other products are ignored', async () => {
  const r = await checkPriceVariance({ productId: String(productId), unitPrice: 51 });
  assert.equal(r.last.unitPrice, 6.7);
  assert.equal(r.last.code, '000000000008');
  assert.equal(r.average, 6.7, 'the cancelled PO at 500 is not part of the history');
  assert.equal(r.count, 1);
  assert.equal(r.vsLastPct, 661.19);
  assert.equal(r.warn, true);
});

test('CHG-07: a price within the threshold does not warn; no history means no warning', async () => {
  assert.equal((await checkPriceVariance({ productId: String(productId), unitPrice: 7.5 })).warn, false); // +11.9%
  assert.equal((await checkPriceVariance({ productId: String(productId), unitPrice: 5 })).warn, true); // -25.4%
  const none = await checkPriceVariance({ productId: String(new mongoose.Types.ObjectId()), unitPrice: 5 });
  assert.equal(none.warn, false);
  assert.equal(none.last, null);
  assert.equal((await checkPriceVariance({ productId: 'not-an-id', unitPrice: 5 })).warn, false);
});

test('CHG-07: the threshold follows the company setting; the edited PO is left out of its own history', async () => {
  await settings.updateCompanySettings({ priceVarianceWarnPct: 1000 }, null);
  assert.equal((await checkPriceVariance({ productId: String(productId), unitPrice: 51 })).warn, false);
  await settings.updateCompanySettings({ priceVarianceWarnPct: 20 }, null);
  const po8 = await Requisition.collection.findOne({ code: '000000000008' });
  const r = await checkPriceVariance({ productId: String(productId), unitPrice: 51, excludeId: String(po8._id) });
  assert.equal(r.last, null);
  assert.equal(r.warn, false);
});
