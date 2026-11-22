const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// System-wide fix program, Phase A / Feature 4: "add PO VAT selection like Purchase Invoice."
// Investigation finding, confirmed by direct code reading (purchaseOrder.js's own comments,
// utils/vatTreatment.js's doc comments, and routes/import/importPurchaseInvoiceRoute.js's comment
// "the real manual 'Create Purchase Invoice' endpoint uses (routes/po/poRoute.js)") - there is no
// separate Purchase Invoice model or document in this codebase. "Purchase Order" IS the Purchase
// Invoice; the model already carries vatPercentage/vatAmount/vatExemptReason/vatTreatment/
// withholdingTax*, computed through the exact same computeOrderTotals() a Sales Order uses, and
// the frontend's "new PO" page already wires all of it via the shared useInvoiceVat() hook. This
// test verifies that end to end rather than taking the code comments' word for it, and is the
// regression guard for this already-existing behavior (no new code was needed for Feature 4
// itself - see the implementation report).
//
// Self-skips without TEST_DB_URI, like every other DB-backed suite in this repo.
const DB_URI = process.env.TEST_DB_URI;
const RUN = !!DB_URI;
const maybeTest = RUN ? test : test.skip;

let PurchaseOrder, Requisition, Vendor, Warehouse, Product, Category, Project, vendor, warehouse, product, project, requisition;

before(async () => {
  if (!RUN) return;
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  PurchaseOrder = require('../../models/vendor/purchaseOrder');
  Requisition = require('../../models/vendor/requisitionModel');
  Vendor = require('../../models/vendor/vendor');
  Warehouse = require('../../models/inventory/warehouseModel');
  Product = require('../../models/inventory/productModel');
  Category = require('../../models/categoryModel');
  Project = require('../../models/project/projectModel');

  vendor = await Vendor.create({ name: 'Test Vendor', contact: { phone: '01011112222' } });
  warehouse = await Warehouse.create({ name: 'Main Warehouse', location: 'Cairo' });
  const category = await Category.create({ name: { en: 'Electrical', ar: 'كهرباء' } });
  product = await Product.create({ title: { en: 'Test Cable', ar: 'كابل تجريبي' }, description: { en: '-', ar: '-' }, type: 'product', category: category._id });
  project = await Project.create({ name: 'Test Project', contractValue: 100000, projectNumber: 'TEST-0001' });
  // Every NEW Purchase Invoice (PurchaseOrder model) must reference an OPEN Purchase Order
  // (Requisition model) with enough remaining quantity on the product - see
  // requisitionQuantityService.js. One generously-sized, open Requisition covers every fixture
  // invoice this suite creates (well under its 1000-unit line).
  requisition = await Requisition.create({
    vendorId: vendor._id, project: project._id, status: 'open',
    items: [{ product: product._id, description: 'Test Cable', quantity: 1000, unit: 'm', unitPrice: 100 }],
  });
});

after(async () => {
  if (!RUN) return;
  await mongoose.disconnect();
});

function baseItem(qty = 10, price = 100) {
  return { productId: product._id, unitPrice: price, starterQuantity: qty, starterSubtotal: qty * price };
}

maybeTest('14% VAT (the existing default rate) computes vatAmount and grandTotal correctly', async () => {
  const po = await PurchaseOrder.create({ vendorId: vendor._id, warehouseId: warehouse._id, project: project._id, requisition: requisition._id, items: [baseItem(10, 100)], vatPercentage: 14 });
  assert.equal(po.totalAmount, 1000);
  assert.equal(po.vatAmount, 140);
  assert.equal(po.grandTotal, 1140);
});

maybeTest('0% VAT is accepted at the model level (the exempt-reason requirement is enforced by the request validator, not the schema)', async () => {
  const po = await PurchaseOrder.create({ vendorId: vendor._id, warehouseId: warehouse._id, project: project._id, requisition: requisition._id, items: [baseItem(5, 200)], vatPercentage: 0, vatExemptReason: 'Zero-rated export sale' });
  assert.equal(po.vatAmount, 0);
  assert.equal(po.grandTotal, 1000);
  assert.equal(po.vatExemptReason, 'Zero-rated export sale');
});

maybeTest('the REAL request validator chain requires a reason (>=3 chars) when VAT is explicitly 0%', async () => {
  const { vatAndWithholdingTaxValidators } = require('../../utils/validators/taxValidators');
  const { validationResult } = require('express-validator');

  async function runChain(body) {
    const req = { body };
    await Promise.all(vatAndWithholdingTaxValidators.map(v => v.run(req)));
    return validationResult(req);
  }

  const noReason = await runChain({ vatPercentage: 0, vatExemptReason: '' });
  assert.equal(noReason.isEmpty(), false);
  assert.match(noReason.array().map(e => e.msg).join(';'), /give the reason/);

  const tooShort = await runChain({ vatPercentage: 0, vatExemptReason: 'ok' });
  assert.equal(tooShort.isEmpty(), false);

  const withReason = await runChain({ vatPercentage: 0, vatExemptReason: 'N/A' });
  assert.equal(withReason.isEmpty(), true);

  const nonZero = await runChain({ vatPercentage: 14 });
  assert.equal(nonZero.isEmpty(), true);

  const invalidWithholding = await runChain({ vatPercentage: 14, withholdingTaxPercentage: 2 });
  assert.equal(invalidWithholding.isEmpty(), false);

  const invalidTreatment = await runChain({ vatPercentage: 14, vatTreatment: 'bogus' });
  assert.equal(invalidTreatment.isEmpty(), false);
});

maybeTest('withholding tax and VAT combine correctly in grandTotal (VAT added, withholding subtracted)', async () => {
  const po = await PurchaseOrder.create({ vendorId: vendor._id, warehouseId: warehouse._id, project: project._id, requisition: requisition._id, items: [baseItem(1, 10000)], vatPercentage: 14, withholdingTaxPercentage: 1 });
  assert.equal(po.totalAmount, 10000);
  assert.equal(po.vatAmount, 1400);
  assert.equal(po.withholdingTaxAmount, 100);
  assert.equal(po.grandTotal, 10000 + 1400 - 100);
});

maybeTest('vatTreatment defaults to "recoverable" (today\'s only pre-existing behavior) and is rejected if invalid', async () => {
  const po = await PurchaseOrder.create({ vendorId: vendor._id, warehouseId: warehouse._id, project: project._id, requisition: requisition._id, items: [baseItem(1, 100)], vatPercentage: 14 });
  assert.equal(po.vatTreatment, 'recoverable');
  await assert.rejects(
    PurchaseOrder.create({ vendorId: vendor._id, warehouseId: warehouse._id, project: project._id, requisition: requisition._id, items: [baseItem(1, 100)], vatPercentage: 14, vatTreatment: 'bogus' }),
  );
});

maybeTest('there is no update route for Purchase Orders (VAT is set once at creation and never re-applied) - this is a pre-existing, deliberate invariant, not a gap', () => {
  const poRouteSource = require('fs').readFileSync(require('path').join(__dirname, '../../routes/po/poRoute.js'), 'utf8');
  assert.ok(!/router\.(patch|put)\(['"]\/:id['"]/.test(poRouteSource), 'expected no PATCH/PUT /:id route on Purchase Orders');
});
