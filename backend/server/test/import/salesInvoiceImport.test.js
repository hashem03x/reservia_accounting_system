const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const os = require('os');
const path = require('path');
const fs = require('fs').promises;

// Sales Invoice CSV Import - Phase 4 (docs section "Sales Invoice CSV Import", new - no previous
// importer existed for this document). Every group is created via the REAL createSalesOrder
// service (services/sales/salesOrderCreation.service.js) - a plain async function, not
// Express-coupled, called directly (no req/res stub needed, unlike Phase 3's Purchase Invoice
// importer). It manages its own transaction, which only a replica set supports - the same
// `transactionsSupported` probe-and-skip gate used throughout this codebase's existing
// transactional tests gates every COMMIT test here. Preview-only tests never transact and always
// run.

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_sales_invoice_import';

let User, Project, Warehouse, Product, SalesOrder, JournalEntry;
let previewGroupedImport, commitGroupedImport;
let invoiceSchema;
let transactionsSupported = true;

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  User = require('../../models/userModel');
  Project = require('../../models/project/projectModel');
  Warehouse = require('../../models/inventory/warehouseModel');
  Product = require('../../models/inventory/productModel');
  SalesOrder = require('../../models/sales/salesOrderModel');
  JournalEntry = require('../../models/accounting/journalEntryModel');
  ({ previewGroupedImport, commitGroupedImport } = require('../../services/csvImport/groupedCsvImportRunner'));
  invoiceSchema = require('../../utils/validators/import/salesInvoiceImportSchema');
  await Promise.all([User.init(), Project.init(), SalesOrder.init(), JournalEntry.init()]);

  const probe = await mongoose.startSession();
  try {
    await probe.withTransaction(async () => {
      await mongoose.connection.collection('__txn_probe').insertOne({ ok: 1 }, { session: probe });
    });
  } catch (err) {
    transactionsSupported = false;
  } finally {
    probe.endSession();
  }
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

let seq = 0;
let manager, customer, project, warehouse, product;

beforeEach(async () => {
  await Promise.all(
    ['users', 'projects', 'warehouses', 'products', 'salesorders', 'journalentries', 'counters'].map(c => mongoose.connection.collection(c).deleteMany({})),
  );
  seq += 1;
  manager = await User.create({ name: 'Sales Import Manager', email: `sales-import-mgr-${seq}@example.com`, role: 'admin', type: 'online' });
  customer = await User.create({ name: 'Sales Import Customer', email: `sales-import-cust-${seq}@example.com`, role: 'user', type: 'online' });
  project = await Project.create({
    projectNumber: `SINV-PRJ-${seq}`,
    projectManager: manager._id,
    customer: customer._id,
    startDate: new Date('2026-01-01'),
    deliveryDate: new Date('2026-12-31'),
    status: 'active',
  });
  warehouse = await Warehouse.create({ name: `Sales Import Warehouse ${seq}`, location: 'Cairo' });
  product = await Product.create({
    type: 'product',
    title: { en: 'Sales Import Product', ar: 'منتج' },
    description: { en: 'd', ar: 'د' },
    price: 500,
    cost: 200,
    category: new mongoose.Types.ObjectId(),
    subcategory: new mongoose.Types.ObjectId(),
    barcode: `SINV-BARCODE-${seq}`,
    stock: [],
  });
});

async function writeTempCsv(content) {
  const file = path.join(os.tmpdir(), `sales-invoice-import-test-${Date.now()}-${Math.random().toString(36).slice(2)}.csv`);
  await fs.writeFile(file, content, 'utf-8');
  return { path: file };
}

const HEADER = 'InvoiceReference,CustomerNumber,ProjectNumber,WarehouseName,ProductCode,Quantity,UnitPrice,ItemDiscountType,ItemDiscountValue,VATPercentage,WithholdingTaxPercentage,PaymentMethod,PaymentAccountCode,ShippingCost,Notes';

function row({ invoiceRef, qty = 1, price = 500 }) {
  return `${invoiceRef},${customer.customerNumber},${project.projectNumber},${warehouse.name},${product.barcode},${qty},${price},,,,,,,,`;
}

// ===================== Preview validation (no transaction needed) =====================

test('1. Preview: a valid sales invoice previews cleanly', async () => {
  const file = await writeTempCsv(`${HEADER}\n${row({ invoiceRef: 'SINV-1', qty: 2, price: 5000 })}\n`);
  const result = await previewGroupedImport(file, invoiceSchema);
  assert.equal(result.validCount, 1, JSON.stringify(result.errors));
  assert.equal(await SalesOrder.countDocuments({}), 0, 'preview must never write anything');
});

test('2. Multiple line items with the same InvoiceReference group into one invoice', async () => {
  const product2 = await Product.create({
    type: 'service',
    title: { en: 'Install Service', ar: 'خدمة' },
    description: { en: 'd', ar: 'د' },
    price: 300,
    durationValue: 1,
    durationUnit: 'month',
    barcode: `SINV-SERVICE-${seq}`,
  });
  const file = await writeTempCsv(
    `${HEADER}\n${row({ invoiceRef: 'SINV-MULTI', qty: 1, price: 5000 })}\n` +
      `SINV-MULTI,${customer.customerNumber},${project.projectNumber},${warehouse.name},${product2.barcode},1,300,,,,,,,,\n`,
  );
  const result = await previewGroupedImport(file, invoiceSchema);
  assert.equal(result.totalGroups, 1);
  assert.equal(result.validCount, 1, JSON.stringify(result.errors));
});

test('Invalid customer/project relationship: non-existent customer is rejected', async () => {
  const file = await writeTempCsv(`${HEADER}\nSINV-NOCUST,999999,${project.projectNumber},${warehouse.name},${product.barcode},1,500,,,,,,,,\n`);
  const result = await previewGroupedImport(file, invoiceSchema);
  assert.equal(result.validCount, 0);
  assert.ok(result.errors[0].errors.some(e => e.column === 'CustomerNumber' && /no customer found/i.test(e.message)));
});

test('A cancelled project is rejected as ineligible', async () => {
  const cancelledProject = await Project.create({
    projectNumber: `SINV-CANCELLED-${seq}`,
    projectManager: manager._id,
    customer: customer._id,
    startDate: new Date(),
    deliveryDate: new Date(Date.now() + 86400000),
    status: 'cancelled',
  });
  const file = await writeTempCsv(`${HEADER}\nSINV-CANCELLEDPROJ,${customer.customerNumber},${cancelledProject.projectNumber},${warehouse.name},${product.barcode},1,500,,,,,,,,\n`);
  const result = await previewGroupedImport(file, invoiceSchema);
  assert.equal(result.validCount, 0);
  assert.ok(result.errors[0].errors.some(e => e.column === 'ProjectNumber' && /cancelled/i.test(e.message)));
});

test('An unresolvable ProductCode is rejected', async () => {
  const file = await writeTempCsv(`${HEADER}\nSINV-BADPRODUCT,${customer.customerNumber},${project.projectNumber},${warehouse.name},NO-SUCH-BARCODE,1,500,,,,,,,,\n`);
  const result = await previewGroupedImport(file, invoiceSchema);
  assert.equal(result.validCount, 0);
  assert.ok(result.errors[0].errors.some(e => e.column === 'ProductCode'));
});

test('Duplicate InvoiceReference against an existing invoice is rejected', async () => {
  await SalesOrder.create({
    customer: customer._id,
    warehouse: warehouse._id,
    project: project._id,
    orderSource: 'cashier',
    employee: manager._id,
    importReference: 'SINV-DUPE',
    items: [{ product: product._id, unitPrice: 500, starterQuantity: 1 }],
  });
  const file = await writeTempCsv(`${HEADER}\n${row({ invoiceRef: 'SINV-DUPE' })}\n`);
  const result = await previewGroupedImport(file, invoiceSchema);
  assert.equal(result.validCount, 0);
  assert.ok(result.errors[0].errors.some(e => e.column === 'InvoiceReference' && /already been imported/i.test(e.message)));
});

test('Invalid tax values are rejected', async () => {
  const file = await writeTempCsv(
    `InvoiceReference,CustomerNumber,ProjectNumber,WarehouseName,ProductCode,Quantity,UnitPrice,ItemDiscountType,ItemDiscountValue,VATPercentage,WithholdingTaxPercentage,PaymentMethod,PaymentAccountCode,ShippingCost,Notes\n` +
      `SINV-BADWHT,${customer.customerNumber},${project.projectNumber},${warehouse.name},${product.barcode},1,500,,,,2,,,,\n`,
  );
  const result = await previewGroupedImport(file, invoiceSchema);
  assert.equal(result.validCount, 0);
  assert.ok(result.errors[0].errors.some(e => e.column === 'WithholdingTaxPercentage'));
});

test('Inconsistent invoice-level data across rows of the same group (different CustomerNumber) is rejected', async () => {
  const otherCustomer = await User.create({ name: 'Other Customer', email: `sinv-other-${seq}@example.com`, role: 'user', type: 'online' });
  const file = await writeTempCsv(
    `${HEADER}\n${row({ invoiceRef: 'SINV-INCONSISTENT' })}\n` +
      `SINV-INCONSISTENT,${otherCustomer.customerNumber},${project.projectNumber},${warehouse.name},${product.barcode},1,500,,,,,,,,\n`,
  );
  const result = await previewGroupedImport(file, invoiceSchema);
  assert.equal(result.validCount, 0);
  assert.ok(result.errors[0].errors.some(e => e.column === 'CustomerNumber' && /must share the same/i.test(e.message)));
});

test('Sample template: headers and example rows stay aligned', () => {
  for (const r of invoiceSchema.exampleRows) {
    assert.equal(r.length, invoiceSchema.headers.length);
  }
});

// ===================== Commit via the REAL createSalesOrder (needs a replica set) =====================

test('3. Commit creates a real invoice through createSalesOrder, posting the exact same journal entries and executed % as manual creation', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  await Product.updateOne({ _id: product._id }, { $set: { stock: [{ warehouse: warehouse._id, quantity: 100 }] } });
  project.contractValue = 100000;
  await project.save();

  const file = await writeTempCsv(`${HEADER}\n${row({ invoiceRef: 'SINV-REAL-1', qty: 10, price: 1000 })}\n`);
  const beforeEntries = await JournalEntry.countDocuments({});
  const { created, failed } = await commitGroupedImport(file, invoiceSchema, { userId: manager._id });
  assert.equal(failed.length, 0, JSON.stringify(failed));
  assert.equal(created.length, 1);

  const invoice = await SalesOrder.findById(created[0].id);
  assert.equal(invoice.totalAmount, 10000);
  assert.ok(invoice.code);

  const afterEntries = await JournalEntry.countDocuments({});
  assert.ok(afterEntries > beforeEntries, 'the real createSalesOrder service must post journal entries, same as manual creation');

  const reloadedProject = await Project.findById(project._id);
  assert.equal(reloadedProject.executedPercentage, 10, 'the project\'s executed % must be recalculated exactly as a manually-created invoice would');
});

test('4. Duplicate InvoiceReference at commit time is rejected, no second invoice or journal entry created', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  await Product.updateOne({ _id: product._id }, { $set: { stock: [{ warehouse: warehouse._id, quantity: 100 }] } });

  const file1 = await writeTempCsv(`${HEADER}\n${row({ invoiceRef: 'SINV-COMMIT-DUPE', qty: 1, price: 1000 })}\n`);
  const result1 = await commitGroupedImport(file1, invoiceSchema, { userId: manager._id });
  assert.equal(result1.created.length, 1, JSON.stringify(result1.failed));
  const entriesAfterFirst = await JournalEntry.countDocuments({});

  const file2 = await writeTempCsv(`${HEADER}\n${row({ invoiceRef: 'SINV-COMMIT-DUPE', qty: 1, price: 1000 })}\n`);
  const result2 = await commitGroupedImport(file2, invoiceSchema, { userId: manager._id });
  assert.equal(result2.created.length, 0, 'retrying the same InvoiceReference must never create a second invoice');

  assert.equal(await SalesOrder.countDocuments({ importReference: 'SINV-COMMIT-DUPE' }), 1);
  assert.equal(await JournalEntry.countDocuments({}), entriesAfterFirst, 'a rejected retry must post no additional journal entries');
});

test('No accounting side effects from a failed/rejected import attempt', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  // No stock configured for the product in this warehouse - the real service's stock-update step
  // will fail, and the whole transaction must roll back with no partial trace.
  const beforeEntries = await JournalEntry.countDocuments({});
  const beforeOrders = await SalesOrder.countDocuments({});

  const file = await writeTempCsv(`${HEADER}\n${row({ invoiceRef: 'SINV-NOSTOCK', qty: 5, price: 1000 })}\n`);
  const { created, failed } = await commitGroupedImport(file, invoiceSchema, { userId: manager._id });
  assert.equal(created.length, 0);
  assert.equal(failed.length, 1);

  assert.equal(await JournalEntry.countDocuments({}), beforeEntries);
  assert.equal(await SalesOrder.countDocuments({}), beforeOrders);
});
