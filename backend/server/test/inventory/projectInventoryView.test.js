const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Project-oriented inventory view (docs section "Inventory / Warehouses - Detailed PUC and Raw
// Materials Per Project") - services/inventory/pucTransferService.js#listProjectInventory, reading
// the SAME PucTransfer allocation records poProjectAllocationService.js already creates when a
// Purchase Invoice is received against a project (never re-derived from PurchaseOrder line items
// separately, which is what would double-count a PO/Invoice and its own inventory movement).

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_project_inventory_view';

let Requisition, PurchaseOrder, Vendor, Project, User, Warehouse, Product, Category, Brand, PucTransfer;
let allocatePurchaseOrderToProject, listProjectInventory;

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  Warehouse = require('../../models/inventory/warehouseModel');
  Requisition = require('../../models/vendor/requisitionModel');
  PurchaseOrder = require('../../models/vendor/purchaseOrder');
  Vendor = require('../../models/vendor/vendor');
  Project = require('../../models/project/projectModel');
  User = require('../../models/userModel');
  Product = require('../../models/inventory/productModel');
  Category = require('../../models/categoryModel');
  Brand = require('../../models/brandModel');
  PucTransfer = require('../../models/inventory/pucTransferModel');
  ({ allocatePurchaseOrderToProject } = require('../../services/inventory/poProjectAllocationService'));
  ({ listProjectInventory } = require('../../services/inventory/pucTransferService'));
  await Promise.all([Requisition.init(), PurchaseOrder.init(), Vendor.init(), Project.init(), Product.init(), PucTransfer.init()]);
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

let seq = 0;
let vendor, project, manager, warehouse, category, brandAcme, brandOther;

beforeEach(async () => {
  await Promise.all(
    ['requisitions', 'purchaseorders', 'vendors', 'projects', 'users', 'warehouses', 'products', 'categories', 'brands', 'puctransfers', 'counters'].map(c =>
      mongoose.connection.collection(c).deleteMany({}),
    ),
  );
  seq += 1;
  manager = await User.create({ name: 'Inv Manager', email: `inv-manager-${seq}@example.com`, role: 'admin', type: 'online' });
  vendor = await Vendor.create({ name: 'Inventory Vendor', contact: { phone: `010${Date.now()}${seq}`.slice(0, 11) } });
  project = await Project.create({ projectNumber: `INV-PRJ-${seq}`, projectManager: manager._id, startDate: new Date('2026-01-01'), deliveryDate: new Date('2026-12-31') });
  warehouse = await Warehouse.create({ name: 'Inventory Warehouse', location: 'Cairo' });
  category = await Category.create({ name: { en: 'Materials', ar: 'مواد' } });
  brandAcme = await Brand.create({ name: { en: 'ACME', ar: 'أكمي' } });
  brandOther = await Brand.create({ name: { en: 'OtherBrand', ar: 'ماركة أخرى' } });
});

async function makeProduct(overrides = {}) {
  seq += 1;
  return Product.create({
    type: 'product',
    title: { en: `Product ${seq}`, ar: `منتج ${seq}` },
    description: { en: 'd', ar: 'د' },
    price: 100,
    cost: 50,
    category: category._id,
    brand: brandAcme._id,
    stock: [{ warehouse: warehouse._id, quantity: 1000 }],
    ...overrides,
  });
}

async function openRequisition() {
  const req = await Requisition.create({ vendorId: vendor._id, project: project._id, items: [{ description: 'x', quantity: 1, unitPrice: 1000000 }] });
  req.status = 'open';
  await req.save();
  return req;
}

async function createAndAllocateInvoice(product, { quantity = 10, unitPrice = 50 } = {}) {
  const requisition = await openRequisition();
  const invoice = await PurchaseOrder.create({
    vendorId: vendor._id,
    warehouseId: warehouse._id,
    project: project._id,
    requisition: requisition._id,
    items: [{ productId: product._id, unitPrice, starterQuantity: quantity }],
  });
  await allocatePurchaseOrderToProject(invoice._id, { userId: manager._id });
  return invoice;
}

test('lists a purchased, allocated item with its product identity, PO/vendor reference, and amounts', async () => {
  const product = await makeProduct({ model: 'PX-100', sku: 'SKU-100' });
  const invoice = await createAndAllocateInvoice(product, { quantity: 10, unitPrice: 50 });

  const result = await listProjectInventory(project._id);
  assert.equal(result.project.projectNumber, project.projectNumber);
  assert.equal(result.data.length, 1);

  const row = result.data[0];
  assert.equal(row.sourceType, 'purchase-order');
  assert.equal(row.quantity, 10);
  assert.equal(row.unitCost, 50);
  assert.equal(row.amount, 500);
  assert.equal(String(row.product._id), String(product._id));
  assert.equal(row.product.model, 'PX-100');
  assert.equal(String(row.product.brand), String(brandAcme._id));
  assert.equal(String(row.purchaseOrder._id), String(invoice._id));
  assert.equal(String(row.purchaseOrder.vendor._id), String(vendor._id));

  assert.equal(result.summary.totalQuantityPurchased, 10);
  assert.equal(result.summary.totalAmount, 500);
  // Explicitly not tracked anywhere in this codebase - never fabricated.
  assert.equal(result.summary.quantityUsed, null);
  assert.equal(result.summary.quantityRemaining, null);
});

test('aggregates multiple purchases of different products for the same project', async () => {
  const productA = await makeProduct({ sku: 'SKU-A' });
  const productB = await makeProduct({ sku: 'SKU-B', brand: brandOther._id });
  await createAndAllocateInvoice(productA, { quantity: 5, unitPrice: 20 });
  await createAndAllocateInvoice(productB, { quantity: 3, unitPrice: 30 });

  const result = await listProjectInventory(project._id);
  assert.equal(result.data.length, 2);
  assert.equal(result.summary.totalQuantityPurchased, 8);
  assert.equal(result.summary.totalAmount, 190); // 5*20 + 3*30
});

test('filters by brand', async () => {
  const productA = await makeProduct({ sku: 'SKU-A' }); // brandAcme
  const productB = await makeProduct({ sku: 'SKU-B', brand: brandOther._id });
  await createAndAllocateInvoice(productA, { quantity: 5, unitPrice: 20 });
  await createAndAllocateInvoice(productB, { quantity: 3, unitPrice: 30 });

  const result = await listProjectInventory(project._id, { brand: brandOther._id });
  assert.equal(result.data.length, 1);
  assert.equal(String(result.data[0].product.brand), String(brandOther._id));
});

test('filters by product', async () => {
  const productA = await makeProduct({ sku: 'SKU-A' });
  const productB = await makeProduct({ sku: 'SKU-B' });
  await createAndAllocateInvoice(productA, { quantity: 5, unitPrice: 20 });
  await createAndAllocateInvoice(productB, { quantity: 3, unitPrice: 30 });

  const result = await listProjectInventory(project._id, { product: productA._id });
  assert.equal(result.data.length, 1);
  assert.equal(String(result.data[0].product._id), String(productA._id));
});

test('a different project never sees another project\'s purchases (tenant/project scoping)', async () => {
  const otherProject = await Project.create({ projectNumber: `INV-PRJ-${++seq}-OTHER`, projectManager: manager._id, startDate: new Date('2026-01-01'), deliveryDate: new Date('2026-12-31') });
  const product = await makeProduct();
  await createAndAllocateInvoice(product, { quantity: 10, unitPrice: 50 });

  const result = await listProjectInventory(otherProject._id);
  assert.equal(result.data.length, 0);
  assert.equal(result.summary.totalQuantityPurchased, 0);
});

test('a purchase-return release is shown as its own row, never silently netted out of the purchase row', async () => {
  const product = await makeProduct();
  const invoice = await createAndAllocateInvoice(product, { quantity: 10, unitPrice: 50 });

  const { releaseAllocationForReturn } = require('../../services/inventory/poProjectAllocationService');
  const freshInvoice = await PurchaseOrder.findById(invoice._id);
  await releaseAllocationForReturn(freshInvoice, product._id, 4, { userId: manager._id });

  const result = await listProjectInventory(project._id);
  assert.equal(result.data.length, 2, 'the purchase row and the return-release row are both shown');
  const types = result.data.map(r => r.sourceType).sort();
  assert.deepEqual(types, ['purchase-order', 'purchase-return']);

  assert.equal(result.summary.totalQuantityPurchased, 10, 'the original purchase quantity is never silently reduced');
  assert.equal(result.summary.totalQuantityReturned, 4);
  assert.equal(result.summary.netQuantity, 6);
});

test('pagination works and the summary totals reflect the FULL set, not just the current page', async () => {
  const products = await Promise.all(Array.from({ length: 3 }, (_, i) => makeProduct({ sku: `SKU-PAGE-${i}` })));
  for (const p of products) {
    // eslint-disable-next-line no-await-in-loop
    await createAndAllocateInvoice(p, { quantity: 1, unitPrice: 10 });
  }

  const page1 = await listProjectInventory(project._id, { page: 1, limit: 2 });
  assert.equal(page1.data.length, 2);
  assert.equal(page1.pagination.total, 3);
  assert.equal(page1.pagination.totalPages, 2);
  assert.equal(page1.summary.totalQuantityPurchased, 3, 'summary covers all 3 rows, not just the 2 on this page');

  const page2 = await listProjectInventory(project._id, { page: 2, limit: 2 });
  assert.equal(page2.data.length, 1);
});

test('rejects an invalid or non-existent project id', async () => {
  await assert.rejects(() => listProjectInventory('not-a-valid-id'), /Invalid project id/);
  await assert.rejects(() => listProjectInventory(new mongoose.Types.ObjectId()), /Project not found/);
});
