const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Feature 3/B4 - Create PR: creating a real ERP Purchase Order (Requisition) from one Deal Engine
// BOQ line. Exercises the real service against a real (local) database: vendor resolution through
// the B1/B2 link, product resolution through the shared matcher, and - the part most likely to
// have a subtle bug - that a BOQ line's quantity can never be oversubscribed across repeated or
// split "Create PR" calls.
//
// Self-skips without TEST_DB_URI, like every other DB-backed suite in this repo. The one genuinely
// CONCURRENT race test additionally needs a real replica set (session.withTransaction) and self-
// skips on a standalone Mongo, same documented limitation as test/vendor/vendorPaymentAccounts.test.js.
const DB_URI = process.env.TEST_DB_URI;
const RUN = !!DB_URI;
const maybeTest = RUN ? test : test.skip;

let Project, CommercialProject, CommercialRevision, CommercialSupplier, Product, Category, Requisition, createPrService;
let erpProject, product, linkedSupplier, unlinkedSupplier;

before(async () => {
  if (!RUN) return;
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  require('../../models/userModel');
  Project = require('../../models/project/projectModel');
  CommercialProject = require('../../models/commercial/commercialProjectModel');
  CommercialRevision = require('../../models/commercial/commercialRevisionModel');
  CommercialSupplier = require('../../models/commercial/supplierModel');
  Product = require('../../models/inventory/productModel');
  Category = require('../../models/categoryModel');
  const Vendor = require('../../models/vendor/vendor');
  Requisition = require('../../models/vendor/requisitionModel');
  createPrService = require('../../services/commercial/createPrService');

  erpProject = await Project.create({ name: 'Test ERP Project', contractValue: 500000, projectNumber: 'TEST-PR-0001' });
  const category = await Category.create({ name: { en: 'Electrical', ar: 'كهرباء' } });
  product = await Product.create({ type: 'product', title: { en: 'PV Module 475W', ar: 'لوح شمسي 475' }, description: { en: '-', ar: '-' }, category: category._id });

  const vendor = await Vendor.create({ name: 'Linked Vendor', contact: { phone: '01011110000' } });
  linkedSupplier = await CommercialSupplier.create({ code: 'SUP-L1', legalName: 'Linked Supplier', status: 'Approved', erpVendor: vendor._id });
  unlinkedSupplier = await CommercialSupplier.create({ code: 'SUP-U1', legalName: 'Unlinked Supplier', status: 'Approved' });
});

after(async () => {
  if (!RUN) return;
  await mongoose.disconnect();
});

async function makeDeal({ qty = 100, vendor = linkedSupplier._id } = {}) {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const commercialProject = await CommercialProject.create({
    dealNumber: `DEAL-TEST-${suffix}`,
    projectCode: `PRJ-TEST-${suffix}`,
    name: `Test Deal ${suffix}`,
    category: 'On-Grid C&I',
    country: 'Egypt',
    customer: new mongoose.Types.ObjectId(),
    erpProject: erpProject._id,
  });
  const revision = await CommercialRevision.create({
    project: commercialProject._id,
    revisionNumber: 1,
    isCurrent: true,
    boqLines: [{ lineNo: 1, component: 'PV Modules', description: 'PV Module 475W', unit: 'pcs', qty, unitPrice: 100, total: qty * 100, vendor }],
  });
  return { commercialProject, revision };
}

maybeTest('createPrFromBoqLine creates a real Requisition linked to the ERP project, Deal Engine project/revision/component, resolved vendor and product', async () => {
  const { commercialProject, revision } = await makeDeal({ qty: 50 });
  const pr = await createPrService.createPrFromBoqLine(revision._id, 'PV Modules', {}, { role: 'procurement' });
  assert.ok(pr.code);
  assert.equal(String(pr.project._id || pr.project), String(erpProject._id));
  assert.equal(String(pr.dealEngineSource.commercialProject), String(commercialProject._id));
  assert.equal(String(pr.dealEngineSource.revision), String(revision._id));
  assert.equal(pr.dealEngineSource.boqComponent, 'PV Modules');
  assert.equal(pr.status, 'draft');
  assert.equal(pr.items[0].quantity, 50); // full remaining qty by default
});

maybeTest('refuses when the BOQ line has no vendor and none is given', async () => {
  const { revision } = await makeDeal({ qty: 10, vendor: null });
  await assert.rejects(createPrService.createPrFromBoqLine(revision._id, 'PV Modules', {}, { role: 'md' }), /Select a vendor/);
});

maybeTest('refuses when the resolved supplier has no linked ERP vendor (the B1/B2 link is mandatory, never implicitly created)', async () => {
  const { revision } = await makeDeal({ qty: 10, vendor: unlinkedSupplier._id });
  await assert.rejects(createPrService.createPrFromBoqLine(revision._id, 'PV Modules', {}, { role: 'md' }), /not yet linked to an ERP vendor/);
});

// Go-live Developer Pack section 5.4: "Create PR / PO" is now Draft for Sales Engineer too
// (sales was added to BOQ_VENDOR_ROLES) - technical/member stay unauthorized.
maybeTest('refuses an unauthorized role', async () => {
  const { revision } = await makeDeal({ qty: 10 });
  await assert.rejects(createPrService.createPrFromBoqLine(revision._id, 'PV Modules', {}, { role: 'technical' }), /is for:/);
});

maybeTest('go-live: sales and bdm may now draft a PR from a BOQ line (section 5.4 "Create PR / PO: Draft")', async () => {
  const { revision } = await makeDeal({ qty: 20 });
  const bySales = await createPrService.createPrFromBoqLine(revision._id, 'PV Modules', { quantity: 5 }, { role: 'sales' });
  assert.ok(bySales._id);
  const byBdm = await createPrService.createPrFromBoqLine(revision._id, 'PV Modules', { quantity: 5 }, { role: 'bdm' });
  assert.ok(byBdm._id);
});

maybeTest('split procurement: two Create PR calls for less than the full quantity both succeed and sum correctly; a third exceeding the remainder is refused', async () => {
  const { revision } = await makeDeal({ qty: 100 });
  const first = await createPrService.createPrFromBoqLine(revision._id, 'PV Modules', { quantity: 40 }, { role: 'md' });
  assert.equal(first.items[0].quantity, 40);
  const second = await createPrService.createPrFromBoqLine(revision._id, 'PV Modules', { quantity: 60 }, { role: 'md' });
  assert.equal(second.items[0].quantity, 60);

  const status = await createPrService.getBoqLineProcurementStatus(revision._id, 'PV Modules');
  assert.equal(status.orderedQty, 100);
  assert.equal(status.remainingQty, 0);
  assert.equal(status.requisitions.length, 2);

  await assert.rejects(createPrService.createPrFromBoqLine(revision._id, 'PV Modules', { quantity: 1 }, { role: 'md' }), /Only 0.*remain/);
});

maybeTest('a repeated Create PR call (simulating a duplicate click) after the line is fully procured is refused, never silently creating a second PO for the same remaining 0', async () => {
  const { revision } = await makeDeal({ qty: 20 });
  await createPrService.createPrFromBoqLine(revision._id, 'PV Modules', {}, { role: 'md' });
  await assert.rejects(createPrService.createPrFromBoqLine(revision._id, 'PV Modules', {}, { role: 'md' }), /Only 0.*remain/);
  const status = await createPrService.getBoqLineProcurementStatus(revision._id, 'PV Modules');
  assert.equal(status.requisitions.length, 1);
});

maybeTest('cancelling a Purchase Order frees up its quantity again', async () => {
  const { revision } = await makeDeal({ qty: 30 });
  const pr = await createPrService.createPrFromBoqLine(revision._id, 'PV Modules', {}, { role: 'md' });
  let status = await createPrService.getBoqLineProcurementStatus(revision._id, 'PV Modules');
  assert.equal(status.remainingQty, 0);

  // Mirrors what requisitionController.js#cancelRequisition actually does on cancellation (the
  // status flip itself is plain Mongoose, already covered by the controller/model tests - this
  // test is specifically about the quantity release, so it calls that release function directly
  // rather than going through HTTP).
  await Requisition.updateOne({ _id: pr._id }, { $set: { status: 'cancelled' } });
  await createPrService.releaseOrderedQty(revision._id, 'PV Modules', pr.items[0].quantity);
  status = await createPrService.getBoqLineProcurementStatus(revision._id, 'PV Modules');
  assert.equal(status.remainingQty, 30);
});

// No replica-set probe/skip needed here (unlike test/vendor/vendorPaymentAccounts.test.js) - the
// guard this proves is a single-document atomic findOneAndUpdate, not a multi-document
// transaction, so it is genuinely exercised on a standalone Mongo too.
maybeTest('CONCURRENCY: two simultaneous Create PR calls for the full remaining quantity never BOTH succeed', async () => {
  const { revision } = await makeDeal({ qty: 10 });
  const results = await Promise.allSettled([
    createPrService.createPrFromBoqLine(revision._id, 'PV Modules', {}, { role: 'md' }),
    createPrService.createPrFromBoqLine(revision._id, 'PV Modules', {}, { role: 'md' }),
  ]);
  const fulfilled = results.filter(r => r.status === 'fulfilled');
  assert.equal(fulfilled.length, 1, 'exactly one of the two concurrent Create PR calls should succeed');
  const status = await createPrService.getBoqLineProcurementStatus(revision._id, 'PV Modules');
  assert.equal(status.orderedQty, 10);
});
