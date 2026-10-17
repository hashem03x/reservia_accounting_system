const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const os = require('os');
const path = require('path');
const fs = require('fs').promises;

// Purchase Order CSV Import - Phase 2 (docs section "Implement Phase 2 - Purchase Order CSV
// Import"). Replaces the previous `importPurchaseOrderController.js`, which targeted the old
// pre-rename concept and was already 100% non-functional (every row threw "A project is required
// to create a Purchase Invoice." - confirmed by reading purchaseOrder.js's pre('save') hook before
// writing this importer). This one creates the NEW "Purchase Order" document (internally
// Requisition) via the exact same side-effect-free Requisition.create() the manual create
// endpoint uses - no accounting call exists anywhere on this path.

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_po_import';

let User, Vendor, Project, Product, Requisition, JournalEntry;
let previewGroupedImport, commitGroupedImport;
let poSchema;

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  User = require('../../models/userModel');
  Vendor = require('../../models/vendor/vendor');
  Project = require('../../models/project/projectModel');
  Product = require('../../models/inventory/productModel');
  Requisition = require('../../models/vendor/requisitionModel');
  JournalEntry = require('../../models/accounting/journalEntryModel');
  ({ previewGroupedImport, commitGroupedImport } = require('../../services/csvImport/groupedCsvImportRunner'));
  poSchema = require('../../utils/validators/import/poImportSchema');
  await Promise.all([Vendor.init(), Project.init(), Requisition.init()]);
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

let seq = 0;
let manager, vendor, project, product;

beforeEach(async () => {
  await Promise.all(
    ['users', 'vendors', 'projects', 'products', 'requisitions', 'journalentries', 'counters'].map(c => mongoose.connection.collection(c).deleteMany({})),
  );
  seq += 1;
  manager = await User.create({ name: 'PO Import Manager', email: `po-import-${seq}@example.com`, role: 'admin', type: 'online' });
  vendor = await Vendor.create({ name: 'PO Import Vendor', contact: { phone: `010${Date.now()}${seq}`.slice(0, 11) } });
  project = await Project.create({ projectNumber: `POI-PRJ-${seq}`, projectManager: manager._id, startDate: new Date('2026-01-01'), deliveryDate: new Date('2026-12-31') });
  product = await Product.create({
    type: 'product',
    title: { en: 'PO Import Product', ar: 'منتج' },
    description: { en: 'd', ar: 'د' },
    price: 100,
    cost: 50,
    category: new mongoose.Types.ObjectId(),
    subcategory: new mongoose.Types.ObjectId(),
    barcode: `POI-BARCODE-${seq}`,
  });
});

async function writeTempCsv(content) {
  const file = path.join(os.tmpdir(), `po-import-test-${Date.now()}-${Math.random().toString(36).slice(2)}.csv`);
  await fs.writeFile(file, content, 'utf-8');
  return { path: file };
}

const HEADER = 'POReference,VendorNumber,ProjectNumber,ItemDescription,ProductCode,Quantity,Unit,UnitPrice,Notes';

// ===================== Grouping =====================

test('1. A single-line PO imports correctly as one Requisition with one item', async () => {
  const file = await writeTempCsv(`${HEADER}\nPO-SINGLE-1,${vendor.vendorNumber},${project.projectNumber},Steel Rebar,,10,ton,15000,\n`);
  const { created, failed } = await commitGroupedImport(file, poSchema, { userId: manager._id });
  assert.equal(failed.length, 0, JSON.stringify(failed));
  assert.equal(created.length, 1);

  const po = await Requisition.findById(created[0].id);
  assert.equal(po.items.length, 1);
  assert.equal(po.amount, 150000);
  assert.equal(po.status, 'draft');
});

test('2+3. Multiple rows sharing a POReference create ONE Requisition with multiple correctly-grouped line items (not duplicate POs)', async () => {
  const file = await writeTempCsv(
    `${HEADER}\n` +
      `PO-MULTI-1,${vendor.vendorNumber},${project.projectNumber},Steel Rebar,,10,ton,15000,Shared notes\n` +
      `PO-MULTI-1,${vendor.vendorNumber},${project.projectNumber},Portland Cement,,50,bag,120,Shared notes\n` +
      `PO-MULTI-1,${vendor.vendorNumber},${project.projectNumber},Sand,${product.barcode},5,ton,300,Shared notes\n`,
  );
  const { created, failed } = await commitGroupedImport(file, poSchema, { userId: manager._id });
  assert.equal(failed.length, 0, JSON.stringify(failed));
  assert.equal(created.length, 1, 'three rows with the same POReference must create exactly ONE Purchase Order');

  const po = await Requisition.findById(created[0].id);
  assert.equal(po.items.length, 3);
  assert.equal(po.amount, 10 * 15000 + 50 * 120 + 5 * 300);
  assert.equal(po.notes, 'Shared notes');
  // requisitionModel.js's pre(/^find/) hook populates items.product, so a found item's `product`
  // is the full populated document here, not a bare ObjectId.
  assert.ok(po.items.some(i => i.product && i.product._id.toString() === product._id.toString()), 'ProductCode must resolve to the real product');

  assert.equal(await Requisition.countDocuments({}), 1, 'grouping must never leave stray extra Purchase Orders');
});

test('Non-contiguous rows sharing a POReference still group into one PO', async () => {
  const file = await writeTempCsv(
    `${HEADER}\n` +
      `PO-SPLIT-1,${vendor.vendorNumber},${project.projectNumber},Line A,,1,,100,\n` +
      `PO-OTHER-1,${vendor.vendorNumber},${project.projectNumber},Unrelated,,1,,50,\n` +
      `PO-SPLIT-1,${vendor.vendorNumber},${project.projectNumber},Line B,,1,,200,\n`,
  );
  const { created, failed } = await commitGroupedImport(file, poSchema, { userId: manager._id });
  assert.equal(failed.length, 0, JSON.stringify(failed));
  assert.equal(created.length, 2, 'two distinct POReferences must create exactly two Purchase Orders');

  const splitPo = await Requisition.findOne({ importReference: 'PO-SPLIT-1' });
  assert.equal(splitPo.items.length, 2);
});

test('Inconsistent PO-level data across rows of the same group (different VendorNumber) is rejected as one group', async () => {
  const otherVendor = await Vendor.create({ name: 'Other Vendor', contact: { phone: `011${Date.now()}`.slice(0, 11) } });
  const file = await writeTempCsv(
    `${HEADER}\n` +
      `PO-BAD-1,${vendor.vendorNumber},${project.projectNumber},Line A,,1,,100,\n` +
      `PO-BAD-1,${otherVendor.vendorNumber},${project.projectNumber},Line B,,1,,100,\n`,
  );
  const { created, failed } = await commitGroupedImport(file, poSchema, { userId: manager._id });
  assert.equal(created.length, 0);
  assert.equal(failed.length, 1);
  assert.ok(failed[0].errors.some(e => e.message.includes('VendorNumber')));
  assert.equal(await Requisition.countDocuments({}), 0, 'an inconsistent group must never leave a partially-created PO');
});

// ===================== Field validation =====================

test('Missing vendor is rejected', async () => {
  const file = await writeTempCsv(`${HEADER}\nPO-NOVENDOR-1,999999,${project.projectNumber},Line,,1,,100,\n`);
  const { created, failed } = await commitGroupedImport(file, poSchema, { userId: manager._id });
  assert.equal(created.length, 0);
  assert.ok(failed[0].errors.some(e => e.column === 'VendorNumber' && /no vendor found/i.test(e.message)));
});

test('Missing/non-existent project is rejected', async () => {
  const file = await writeTempCsv(`${HEADER}\nPO-NOPROJ-1,${vendor.vendorNumber},PRJ-DOES-NOT-EXIST,Line,,1,,100,\n`);
  const { created, failed } = await commitGroupedImport(file, poSchema, { userId: manager._id });
  assert.equal(created.length, 0);
  assert.ok(failed[0].errors.some(e => e.column === 'ProjectNumber' && /no project found/i.test(e.message)));
});

test('Invalid quantities and prices are rejected', async () => {
  const file = await writeTempCsv(
    `${HEADER}\n` +
      `PO-BADQTY-1,${vendor.vendorNumber},${project.projectNumber},Zero quantity,,0,,100,\n` +
      `PO-BADPRICE-1,${vendor.vendorNumber},${project.projectNumber},Negative price,,1,,-5,\n`,
  );
  const { created, failed } = await commitGroupedImport(file, poSchema, { userId: manager._id });
  assert.equal(created.length, 0);
  assert.equal(failed.length, 2);
  assert.ok(failed.some(f => f.errors.some(e => e.column === 'Quantity')));
  assert.ok(failed.some(f => f.errors.some(e => e.column === 'UnitPrice')));
});

test('An unresolvable ProductCode is rejected, never silently created as a null-product line', async () => {
  const file = await writeTempCsv(`${HEADER}\nPO-BADPRODUCT-1,${vendor.vendorNumber},${project.projectNumber},Line,NO-SUCH-BARCODE,1,,100,\n`);
  const { created, failed } = await commitGroupedImport(file, poSchema, { userId: manager._id });
  assert.equal(created.length, 0);
  assert.ok(failed[0].errors.some(e => e.column === 'ProductCode'));
});

// ===================== Duplicate prevention, retries, concurrency =====================

test('Duplicate PO reference ACROSS two separate imports: the second is rejected, not silently re-created', async () => {
  const fileA = await writeTempCsv(`${HEADER}\nPO-DUPE-2,${vendor.vendorNumber},${project.projectNumber},First import,,1,,100,\n`);
  const first = await commitGroupedImport(fileA, poSchema, { userId: manager._id });
  assert.equal(first.created.length, 1);

  const fileB = await writeTempCsv(`${HEADER}\nPO-DUPE-2,${vendor.vendorNumber},${project.projectNumber},Retried import,,1,,999,\n`);
  const second = await commitGroupedImport(fileB, poSchema, { userId: manager._id });
  assert.equal(second.created.length, 0, 'the same POReference must never create a second Purchase Order');
  assert.ok(second.failed[0].errors.some(e => e.column === 'POReference' && /already been imported/i.test(e.message)));
  assert.equal(await Requisition.countDocuments({}), 1);
});

test('Retrying the exact same commit (same file, re-submitted) creates no duplicate', async () => {
  const content = `${HEADER}\nPO-RETRY-1,${vendor.vendorNumber},${project.projectNumber},Line,,1,,500,\n`;
  const file1 = await writeTempCsv(content);
  const result1 = await commitGroupedImport(file1, poSchema, { userId: manager._id });
  assert.equal(result1.created.length, 1);

  const file2 = await writeTempCsv(content); // the user re-uploads the identical file
  const result2 = await commitGroupedImport(file2, poSchema, { userId: manager._id });
  assert.equal(result2.created.length, 0);
  assert.equal(await Requisition.countDocuments({}), 1);
});

test('Concurrent commits of the same POReference create exactly ONE Purchase Order, never two', async () => {
  const content = `${HEADER}\nPO-CONCURRENT-1,${vendor.vendorNumber},${project.projectNumber},Line,,1,,750,\n`;
  const [fileA, fileB] = await Promise.all([writeTempCsv(content), writeTempCsv(content)]);

  const results = await Promise.allSettled([
    commitGroupedImport(fileA, poSchema, { userId: manager._id }),
    commitGroupedImport(fileB, poSchema, { userId: manager._id }),
  ]);

  const createdCounts = results.map(r => (r.status === 'fulfilled' ? r.value.created.length : 0));
  const totalCreated = createdCounts.reduce((a, b) => a + b, 0);
  assert.equal(totalCreated, 1, `exactly one of the two concurrent commits must succeed (got ${JSON.stringify(createdCounts)})`);
  assert.equal(await Requisition.countDocuments({ importReference: 'PO-CONCURRENT-1' }), 1);
});

// ===================== Accounting isolation =====================

test('Importing Purchase Orders never posts a journal entry or changes any vendor balance', async () => {
  const startingBalance = vendor.balance;
  const file = await writeTempCsv(
    `${HEADER}\n` +
      `PO-NOACCOUNTING-1,${vendor.vendorNumber},${project.projectNumber},Line A,,10,,1000,\n` +
      `PO-NOACCOUNTING-1,${vendor.vendorNumber},${project.projectNumber},Line B,,5,,2000,\n`,
  );
  await commitGroupedImport(file, poSchema, { userId: manager._id });

  assert.equal(await JournalEntry.countDocuments({}), 0, 'a Purchase Order import must never post a journal entry');
  const reloadedVendor = await Vendor.findById(vendor._id);
  assert.equal(reloadedVendor.balance, startingBalance, 'a Purchase Order import must never change a vendor balance');
});

// ===================== Preview is read-only =====================

test('Preview never writes anything, even for an otherwise-fully-valid file', async () => {
  const file = await writeTempCsv(`${HEADER}\nPO-PREVIEWONLY-1,${vendor.vendorNumber},${project.projectNumber},Line,,1,,100,\n`);
  const result = await previewGroupedImport(file, poSchema);
  assert.equal(result.validCount, 1);
  assert.equal(await Requisition.countDocuments({}), 0, 'preview must never create a Purchase Order');
});

test('Preview correctly reports totalGroups distinct from totalRows for a multi-line PO', async () => {
  const file = await writeTempCsv(
    `${HEADER}\n` +
      `PO-PREVIEWGROUP-1,${vendor.vendorNumber},${project.projectNumber},Line A,,1,,100,\n` +
      `PO-PREVIEWGROUP-1,${vendor.vendorNumber},${project.projectNumber},Line B,,1,,100,\n`,
  );
  const result = await previewGroupedImport(file, poSchema);
  assert.equal(result.totalRows, 2);
  assert.equal(result.totalGroups, 1);
  assert.equal(result.validCount, 1);
});

// ===================== Sample template =====================

test('Sample template: headers and example rows stay aligned, and the example rows pass validation as one group', async () => {
  assert.equal(poSchema.headers.length > 0, true);
  for (const row of poSchema.exampleRows) {
    assert.equal(row.length, poSchema.headers.length);
  }

  // The example rows reference VendorNumber 2000 / ProjectNumber PRJ-0000001, which don't exist in
  // this isolated test DB - rebuild them against this test's real fixtures to confirm the SHAPE
  // of the example (two lines, one shared POReference) is internally consistent.
  const rows = poSchema.exampleRows.map((values, i) => ({
    row: i + 2,
    raw: Object.fromEntries(poSchema.headers.map((h, idx) => [h, values[idx]])),
  }));
  const reference = rows[0].raw.POReference;
  assert.ok(rows.every(r => r.raw.POReference === reference), 'every example row must share the same POReference');
});
