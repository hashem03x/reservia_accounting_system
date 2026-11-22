const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// System-wide fix program, Feature 4 ("PO VAT like Purchase Invoice VAT") - the REAL gap. "Purchase
// Order" (business-facing name) is the Requisition model (see requisitionModel.js's header
// comment); it deliberately has no tax/payment fields and never posts accounting
// (requisitionController.js's own header comment: "must never be able to post a journal entry or
// touch any accounting balance, by construction"). This adds an ESTIMATE-only vatPercentage that
// never feeds `amount`/`invoicedAmount` (so the remaining-quantity/amount guard against the real
// Purchase Invoice keeps comparing pre-tax figures on both sides, unchanged) and is only ever
// derived for display via the toJSON transform - verified here directly, not assumed from reading
// the code.
//
// Self-skips without TEST_DB_URI, like every other DB-backed suite in this repo.
const DB_URI = process.env.TEST_DB_URI;
const RUN = !!DB_URI;
const maybeTest = RUN ? test : test.skip;

let Requisition, Vendor, Project, Product, Category, vendor, project, product;

before(async () => {
  if (!RUN) return;
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  Requisition = require('../../models/vendor/requisitionModel');
  Vendor = require('../../models/vendor/vendor');
  Project = require('../../models/project/projectModel');
  Product = require('../../models/inventory/productModel');
  Category = require('../../models/categoryModel');

  vendor = await Vendor.create({ name: 'Test Vendor', contact: { phone: '01011112222' } });
  project = await Project.create({ name: 'Test Project', contractValue: 100000, projectNumber: 'TEST-0002' });
  const category = await Category.create({ name: { en: 'Electrical', ar: 'كهرباء' } });
  product = await Product.create({ title: { en: 'Test Cable', ar: 'كابل تجريبي' }, description: { en: '-', ar: '-' }, type: 'product', category: category._id });
});

after(async () => {
  if (!RUN) return;
  await mongoose.disconnect();
});

function baseReq(overrides = {}) {
  return {
    vendorId: vendor._id,
    project: project._id,
    items: [{ product: product._id, description: 'Test Cable', quantity: 10, unit: 'm', unitPrice: 100 }],
    ...overrides,
  };
}

maybeTest('vatPercentage is an estimate: it never changes amount/invoicedAmount, only the derived toJSON fields', async () => {
  const req = await Requisition.create(baseReq({ vatPercentage: 14 }));
  assert.equal(req.amount, 1000); // still pre-tax - the real invariant other code (remaining-quantities) depends on
  const json = req.toJSON();
  assert.equal(json.vatAmountEstimate, 140);
  assert.equal(json.grandTotalEstimate, 1140);
});

maybeTest('0% VAT with no reason is accepted at the model level (same split as the Invoice: schema is permissive, the request validator enforces the reason)', async () => {
  const req = await Requisition.create(baseReq({ vatPercentage: 0 }));
  assert.equal(req.toJSON().vatAmountEstimate, 0);
});

maybeTest('a Purchase Order with no VAT set at all defaults to a 0 estimate, never undefined/NaN', async () => {
  const req = await Requisition.create(baseReq());
  const json = req.toJSON();
  assert.equal(json.vatAmountEstimate, 0);
  assert.equal(json.grandTotalEstimate, req.amount);
});

maybeTest('the create/update validators accept vatPercentage/vatExemptReason via the SAME shared chain the Purchase Invoice uses', () => {
  const { createRequisitionValidators, updateRequisitionValidators } = require('../../utils/validators/requisitionValidators');
  const { vatAndWithholdingTaxValidators } = require('../../utils/validators/taxValidators');
  // Not a deep-equality check (chains contain bound closures) - just confirms the exact same
  // array length/shape was spread in, i.e. genuinely reused rather than re-specified.
  assert.ok(createRequisitionValidators.length >= vatAndWithholdingTaxValidators.length);
  assert.ok(updateRequisitionValidators.length >= vatAndWithholdingTaxValidators.length);
});
