const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { validationResult } = require('express-validator');

// ERP CHG-06 (12 Nov 2026): "no VAT" is an explicit choice with a reason, and 0% invoices are listed
// for review. Sales invoices 000000000003-5 had posted with no VAT and nobody noticed.
const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_zero_vat';
const { vatAndWithholdingTaxValidators } = require('../../utils/validators/taxValidators');

async function errorsFor(body) {
  const req = { body };
  for (const v of vatAndWithholdingTaxValidators) await v.run(req); // eslint-disable-line no-await-in-loop
  return validationResult(req)
    .array()
    .map(e => e.msg);
}

let zeroVatInvoices;
before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  require('../../models/inventory/warehouseModel'); // eslint-disable-line global-require
  ({ zeroVatInvoices } = require('../../services/config/zeroVatReportService')); // eslint-disable-line global-require
  const db = mongoose.connection.db;
  const customer = new mongoose.Types.ObjectId();
  const vendor = new mongoose.Types.ObjectId();
  const project = new mongoose.Types.ObjectId();
  await db.collection('users').insertOne({ _id: customer, name: 'Nile Farms' });
  await db.collection('vendors').insertOne({ _id: vendor, name: 'Delta Cables' });
  await db.collection('projects').insertOne({ _id: project, projectNumber: 'COM-0000002' });
  await db.collection('salesorders').insertMany([
    { code: '000000000003', vatPercentage: 0, grandTotal: 500000, customer, project, createdAt: new Date('2026-10-20'), orderStatus: 'delivered' },
    { code: '000000000006', vatPercentage: 14, grandTotal: 2280, customer, project, createdAt: new Date('2026-11-12'), orderStatus: 'delivered' },
    { code: '000000000012', vatPercentage: 0, vatExemptReason: 'Export customer', grandTotal: 1000, customer, project, createdAt: new Date('2026-11-13'), orderStatus: 'delivered' },
    { code: '000000000013', vatPercentage: 0, grandTotal: 1, customer, createdAt: new Date('2026-11-13'), orderStatus: 'canceled' },
  ]);
  await db.collection('purchaseorders').insertMany([{ code: '000000000009', vatPercentage: 0, totalAmount: 5100, vendorId: vendor, project, createdAt: new Date('2026-11-01') }]);
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

test('CHG-06: VAT 0% needs a reason; any other rate, or no VAT field at all (older API clients), does not', async () => {
  assert.ok((await errorsFor({ vatPercentage: 0 })).some(m => /give the reason/.test(m)));
  assert.ok((await errorsFor({ vatPercentage: 0, vatExemptReason: '  ' })).some(m => /give the reason/.test(m)));
  assert.deepEqual(await errorsFor({ vatPercentage: 0, vatExemptReason: 'Export customer' }), []);
  assert.deepEqual(await errorsFor({ vatPercentage: 14 }), []);
  assert.deepEqual(await errorsFor({}), []);
  assert.ok((await errorsFor({ vatPercentage: -1, vatExemptReason: 'x' })).some(m => /cannot be negative/.test(m)));
});

test('CHG-06: the review report lists every 0% sales and purchase invoice with its reason (cancelled excluded)', async () => {
  const { rows, summary } = await zeroVatInvoices();
  assert.deepEqual(rows.map(r => `${r.type}:${r.code}`).sort(), ['purchase:000000000009', 'sales:000000000003', 'sales:000000000012']);
  const legacy = rows.find(r => r.code === '000000000003');
  assert.equal(legacy.reason, null);
  assert.equal(legacy.party, 'Nile Farms');
  assert.equal(legacy.project, 'COM-0000002');
  assert.equal(rows.find(r => r.code === '000000000012').reason, 'Export customer');
  assert.equal(rows.find(r => r.code === '000000000009').party, 'Delta Cables');
  assert.deepEqual(summary, { sales: 2, purchase: 1, withoutReason: 2, amount: 506100 });
  // Date range.
  assert.deepEqual((await zeroVatInvoices({ from: '2026-11-01', to: '2026-11-13' })).rows.map(r => r.code).sort(), ['000000000009', '000000000012']);
});
