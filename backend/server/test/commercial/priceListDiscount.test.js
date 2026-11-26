const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Deal Engine - a blanket percentage discount a supplier wants to apply across what they already
// price, without re-uploading a whole new price list (priceListUploadService.js#
// applyPercentageDiscount). Written through the SAME CommercialPriceListUpload record shape the
// file-upload flow uses, so the existing rollback/history/C24 "flag open revisions" mechanisms
// apply to it unchanged - these tests exercise that reuse end to end, not just the price math.
//
// Self-skips without TEST_DB_URI, like every other DB-backed suite in this repo.
const DB_URI = process.env.TEST_DB_URI;
const RUN = !!DB_URI;
const maybeTest = RUN ? test : test.skip;

let CommercialSupplier, MaterialItem, CommercialRevision, priceListUploadService, supplier;

before(async () => {
  if (!RUN) return;
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  CommercialSupplier = require('../../models/commercial/supplierModel');
  MaterialItem = require('../../models/commercial/materialItemModel');
  CommercialRevision = require('../../models/commercial/commercialRevisionModel');
  priceListUploadService = require('../../services/commercial/priceListUploadService');
});

after(async () => {
  if (!RUN) return;
  await mongoose.disconnect();
});

beforeEach(async () => {
  if (!RUN) return;
  supplier = await CommercialSupplier.create({ code: `SUP-${Date.now()}-${Math.floor(Math.random() * 1e6)}`, legalName: 'Discount Test Supplier', status: 'Approved' });
});

async function makeItem({ key, unitPrice = 1000 }) {
  return MaterialItem.create({
    category: 'PV Modules', brand: 'TestBrand', model: key, unit: 'pcs', unitPrice: 100, currency: 'EGP',
    sourceWorkbook: 'test', sourceSheet: 'test', key,
    supplierPrices: [{ supplier: supplier._id, supplierCode: supplier.code, unitPrice, currency: 'EGP', checkedAt: new Date() }],
  });
}

maybeTest('applyPercentageDiscount reduces every current price for this supplier by the given %, keeps the before value, and creates a confirmed discount-kind upload', async () => {
  const item1 = await makeItem({ key: `K1-${Date.now()}`, unitPrice: 1000 });
  const item2 = await makeItem({ key: `K2-${Date.now()}`, unitPrice: 200 });

  const upload = await priceListUploadService.applyPercentageDiscount(supplier._id, { pct: 10 }, { user: { _id: new mongoose.Types.ObjectId(), name: 'Tester' }, role: 'commercial_director' });

  assert.equal(upload.kind, 'discount');
  assert.equal(upload.discountPct, 10);
  assert.equal(upload.status, 'confirmed');
  assert.equal(upload.changes.length, 2);

  const fresh1 = await MaterialItem.findById(item1._id);
  const fresh2 = await MaterialItem.findById(item2._id);
  assert.equal(fresh1.supplierPrices[0].unitPrice, 900); // 1000 * 0.9
  assert.equal(fresh2.supplierPrices[0].unitPrice, 180); // 200 * 0.9
  // The previous price is preserved on the change record for rollback - never discarded.
  const change1 = upload.changes.find(c => String(c.item) === String(item1._id));
  assert.equal(change1.before.unitPrice, 1000);
  assert.equal(change1.after.unitPrice, 900);
});

maybeTest('applyPercentageDiscount: rolling back the discount restores every original price exactly, via the EXISTING rollback path', async () => {
  const item1 = await makeItem({ key: `K3-${Date.now()}`, unitPrice: 500 });
  const upload = await priceListUploadService.applyPercentageDiscount(supplier._id, { pct: 20 }, { user: { _id: new mongoose.Types.ObjectId(), name: 'Tester' }, role: 'md' });
  assert.equal((await MaterialItem.findById(item1._id)).supplierPrices[0].unitPrice, 400);

  await priceListUploadService.rollbackUpload(upload._id, { user: { _id: new mongoose.Types.ObjectId(), name: 'Tester' }, role: 'md' });

  const restored = await MaterialItem.findById(item1._id);
  assert.equal(restored.supplierPrices[0].unitPrice, 500);
});

maybeTest('applyPercentageDiscount flags an open revision that quotes a discounted item (C24), same as a file upload would', async () => {
  const item = await makeItem({ key: `K4-${Date.now()}`, unitPrice: 1000 });
  const revision = await CommercialRevision.create({
    project: new mongoose.Types.ObjectId(), revisionNumber: 1, isCurrent: true,
    boqLines: [{ lineNo: 1, component: 'PV Modules', materialItemKey: item.key, unit: 'pcs', qty: 10, unitPrice: 1000, total: 10000 }],
  });

  await priceListUploadService.applyPercentageDiscount(supplier._id, { pct: 5 }, { user: { _id: new mongoose.Types.ObjectId(), name: 'Tester' }, role: 'md' });

  const fresh = await CommercialRevision.findById(revision._id);
  assert.equal(fresh.priceChangedSinceCalculation, true);
  assert.ok(fresh.priceChangedItems.includes(item.key));
});

maybeTest('applyPercentageDiscount rejects an invalid percentage (0, negative, >100, non-numeric) - never silently clamps it', async () => {
  await makeItem({ key: `K5-${Date.now()}`, unitPrice: 1000 });
  const ctx = { user: { _id: new mongoose.Types.ObjectId(), name: 'Tester' }, role: 'md' };
  await assert.rejects(priceListUploadService.applyPercentageDiscount(supplier._id, { pct: 0 }, ctx), /greater than 0/);
  await assert.rejects(priceListUploadService.applyPercentageDiscount(supplier._id, { pct: -5 }, ctx), /greater than 0/);
  await assert.rejects(priceListUploadService.applyPercentageDiscount(supplier._id, { pct: 150 }, ctx), /up to 100/);
  await assert.rejects(priceListUploadService.applyPercentageDiscount(supplier._id, { pct: 'abc' }, ctx), /greater than 0/);
});

maybeTest('applyPercentageDiscount refuses for a Suspended or Removed supplier, and for a supplier with no current prices', async () => {
  const ctx = { user: { _id: new mongoose.Types.ObjectId(), name: 'Tester' }, role: 'md' };
  await assert.rejects(priceListUploadService.applyPercentageDiscount(supplier._id, { pct: 10 }, ctx), /no current prices/);

  await makeItem({ key: `K6-${Date.now()}`, unitPrice: 1000 });
  await CommercialSupplier.updateOne({ _id: supplier._id }, { $set: { status: 'Suspended' } });
  await assert.rejects(priceListUploadService.applyPercentageDiscount(supplier._id, { pct: 10 }, ctx), /Suspended/);
});

maybeTest('applyPercentageDiscount refuses an unauthorized role - never bypassed because it skips the upload form', async () => {
  await makeItem({ key: `K7-${Date.now()}`, unitPrice: 1000 });
  await assert.rejects(
    priceListUploadService.applyPercentageDiscount(supplier._id, { pct: 10 }, { user: { _id: new mongoose.Types.ObjectId(), name: 'Tester' }, role: 'sales' }),
    /not allowed to change supplier price lists/
  );
});
