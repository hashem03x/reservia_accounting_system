const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Sales must consume their materials/cost from the PROJECT's PUC balance, never from ordinary
// warehouse inventory (services/inventory/pucSalesConsumptionService.js) - this is the regression
// suite for that mechanism, exercised directly against consumePucForSale/releasePucConsumptionForReturn
// (bypassing the full createSalesOrder orchestration, which needs a replica-set transaction this
// environment may not have - the same reason test/inventory/pucMaterialBalances.test.js exercises
// allocatePurchaseOrderToProject directly rather than through the full createPO controller flow).

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_puc_sales_consumption';

let Requisition, PurchaseOrder, SalesOrder, Vendor, Project, User, Warehouse, Product, Category, Brand, PucTransfer, ChartOfAccount, JournalEntry;
let allocatePurchaseOrderToProject;
let consumePucForSale, releasePucConsumptionForReturn;
let pucAccountBalance, postPurchaseOrderJournalEntries;
let mirrorReverseEntry;

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  Warehouse = require('../../models/inventory/warehouseModel');
  Requisition = require('../../models/vendor/requisitionModel');
  PurchaseOrder = require('../../models/vendor/purchaseOrder');
  SalesOrder = require('../../models/sales/salesOrderModel');
  Vendor = require('../../models/vendor/vendor');
  Project = require('../../models/project/projectModel');
  User = require('../../models/userModel');
  Product = require('../../models/inventory/productModel');
  Category = require('../../models/categoryModel');
  Brand = require('../../models/brandModel');
  PucTransfer = require('../../models/inventory/pucTransferModel');
  ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
  JournalEntry = require('../../models/accounting/journalEntryModel');
  ({ allocatePurchaseOrderToProject } = require('../../services/inventory/poProjectAllocationService'));
  ({ consumePucForSale, releasePucConsumptionForReturn } = require('../../services/inventory/pucSalesConsumptionService'));
  ({ pucAccountBalance, postPurchaseOrderJournalEntries } = require('../../services/accounting/accountingEventService'));
  ({ mirrorReverseEntry } = require('../../services/accounting/journalReversalCore'));
  await Promise.all([Requisition.init(), PurchaseOrder.init(), SalesOrder.init(), Vendor.init(), Project.init(), Product.init(), PucTransfer.init(), ChartOfAccount.init(), JournalEntry.init()]);
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

let seq = 0;
let vendor, project, manager, customer, warehouse, category, brand, wipRawMaterials, costRawMaterials;

beforeEach(async () => {
  await Promise.all(
    [
      'requisitions', 'purchaseorders', 'salesorders', 'vendors', 'projects', 'users', 'warehouses', 'products', 'categories', 'brands',
      'puctransfers', 'counters', 'chartofaccounts', 'journalentries',
    ].map(c => mongoose.connection.collection(c).deleteMany({}))
  );
  seq += 1;
  manager = await User.create({ name: 'Manager', email: `puc-manager-${seq}@example.com`, role: 'admin', type: 'online' });
  customer = await User.create({ name: 'Customer', email: `puc-customer-${seq}@example.com`, role: 'user', type: 'online', customerNumber: seq });
  vendor = await Vendor.create({ name: 'PUC Vendor', contact: { phone: `010${Date.now()}${seq}`.slice(0, 11) } });
  project = await Project.create({ projectNumber: `PUC-PRJ-${seq}`, projectManager: manager._id, startDate: new Date('2026-01-01'), deliveryDate: new Date('2026-12-31') });
  warehouse = await Warehouse.create({ name: 'PUC Warehouse', location: 'Cairo' });
  category = await Category.create({ name: { en: 'Materials', ar: 'مواد' } });
  brand = await Brand.create({ name: { en: 'ACME', ar: 'أكمي' } });
  wipRawMaterials = await ChartOfAccount.create({ code: '11000009', name: 'PUC - Raw Materials', type: 'asset' });
  costRawMaterials = await ChartOfAccount.create({ code: '50000001', name: 'Raw Materials', type: 'cogs' });
  await ChartOfAccount.create({ code: '11000007', name: 'Materials Inventory', type: 'asset' });
  await ChartOfAccount.create({ code: '31000001', name: 'Suppliers - Construction Materials', type: 'liability' });
  await ChartOfAccount.create({ code: '11000017', name: 'Egyptian Tax Authority - VAT', type: 'asset' });
  await ChartOfAccount.create({ code: '31000010', name: 'VAT Payable', type: 'liability' });
  await ChartOfAccount.create({ code: '31000012', name: 'Withholding Taxes Payable', type: 'liability' });
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
    brand: brand._id,
    stock: [{ warehouse: warehouse._id, quantity: 1000 }],
    ...overrides,
  });
}

/** Purchases `quantity` of `product` for `project`, fully allocated to its PUC, at `unitPrice`. */
async function purchaseIntoPuc(product, { quantity = 10, unitPrice = 50 } = {}) {
  const requisition = await Requisition.create({ vendorId: vendor._id, project: project._id, items: [{ description: 'x', quantity: 1, unitPrice: 1000000 }] });
  requisition.status = 'open';
  await requisition.save();
  const invoice = await PurchaseOrder.create({ vendorId: vendor._id, warehouseId: warehouse._id, project: project._id, requisition: requisition._id, items: [{ productId: product._id, unitPrice, starterQuantity: quantity }] });
  // The REAL createPO controller flow always posts the PO's own journal entries (PO_INVENTORY_
  // RECEIPT/PO_INVENTORY_TO_WIP) together with the allocation, in the same transaction - without
  // this, pucAccountBalance (the GL-side figure JV0011/this suite's own assertions read) would
  // never see the purchase that funded this project's PUC in the first place.
  await postPurchaseOrderJournalEntries(invoice, null);
  await allocatePurchaseOrderToProject(invoice._id, { userId: manager._id });
  return invoice;
}

/** A minimal, directly-created Sales Order (bypasses createSalesOrder's own stock/PUC/accounting orchestration - that's exactly what this suite tests in isolation). */
async function makeSalesOrder(itemLines) {
  const so = await SalesOrder.create({
    customer: customer._id,
    warehouse: warehouse._id,
    orderSource: 'cashier',
    project: project._id,
    items: itemLines.map(l => ({ product: l.product._id, unitPrice: l.unitPrice ?? 100, starterQuantity: l.quantity })),
  });
  return so;
}

test('consumes the sold quantity from the project PUC at its weighted average cost, Dr COGS / Cr PUC', async () => {
  const product = await makeProduct();
  await purchaseIntoPuc(product, { quantity: 10, unitPrice: 50 }); // PUC: 10 @ 50 = 500
  const so = await makeSalesOrder([{ product, quantity: 4 }]);

  const entry = await consumePucForSale(so, { userId: manager._id });
  assert.ok(entry);
  assert.equal(entry.accountingAction, 'SALES_PUC_CONSUMPTION');
  const lines = entry.lines.map(l => [String(l.account), l.debit, l.credit]);
  assert.deepEqual(lines, [
    [String(costRawMaterials._id), 200, 0],
    [String(wipRawMaterials._id), 0, 200],
  ]);

  const transfer = await PucTransfer.findOne({ salesOrder: so._id, sourceType: 'sale' }).lean();
  assert.equal(transfer.quantity, 4);
  assert.equal(transfer.unitCost, 50);
  assert.equal(transfer.amount, 200);
  assert.equal(String(transfer.project), String(project._id));

  assert.equal(await pucAccountBalance(wipRawMaterials._id, project._id), 300); // 500 purchased - 200 consumed
});

test('never consumes more than the project actually holds in PUC for that product - caps, never throws, never fabricates', async () => {
  const product = await makeProduct();
  await purchaseIntoPuc(product, { quantity: 5, unitPrice: 50 }); // only 5 available
  const so = await makeSalesOrder([{ product, quantity: 100 }]); // tries to sell 100

  const entry = await consumePucForSale(so, { userId: manager._id });
  const transfer = await PucTransfer.findOne({ salesOrder: so._id, sourceType: 'sale' }).lean();
  assert.equal(transfer.quantity, 5); // capped at what PUC actually holds
  assert.equal(transfer.amount, 250);
  assert.equal(entry.lines.find(l => l.debit > 0).debit, 250);
  assert.equal(await pucAccountBalance(wipRawMaterials._id, project._id), 0);
});

test('a product never purchased into this project\'s PUC is skipped entirely - no fabricated cost, no entry', async () => {
  const neverPurchased = await makeProduct();
  const so = await makeSalesOrder([{ product: neverPurchased, quantity: 3 }]);

  const entry = await consumePucForSale(so, { userId: manager._id });
  assert.equal(entry, null);
  assert.equal(await PucTransfer.countDocuments({ salesOrder: so._id }), 0);
  assert.equal(await JournalEntry.countDocuments({ sourceType: 'SO', sourceId: so._id, accountingAction: 'SALES_PUC_CONSUMPTION' }), 0);
});

test('a service line is skipped (no PUC/stock concept) while a physical line in the same order is still consumed', async () => {
  const material = await makeProduct();
  await purchaseIntoPuc(material, { quantity: 10, unitPrice: 20 });
  const service = await Product.create({ type: 'service', title: { en: 'Install', ar: 'تركيب' }, description: { en: 'd', ar: 'د' }, price: 500, durationValue: 1, durationUnit: 'month' });
  const so = await makeSalesOrder([{ product: material, quantity: 2 }, { product: service, quantity: 1, unitPrice: 500 }]);

  const entry = await consumePucForSale(so, { userId: manager._id });
  assert.ok(entry);
  const records = await PucTransfer.find({ salesOrder: so._id }).lean();
  assert.equal(records.length, 1);
  assert.equal(String(records[0].product), String(material._id));
});

test('calling consumePucForSale twice for the same order is a safe no-op the second time - no duplicate PucTransfer or journal entry', async () => {
  const product = await makeProduct();
  await purchaseIntoPuc(product, { quantity: 10, unitPrice: 50 });
  const so = await makeSalesOrder([{ product, quantity: 4 }]);

  await consumePucForSale(so, { userId: manager._id });
  const second = await consumePucForSale(so, { userId: manager._id });
  assert.equal(second, null, 'the idempotency guard short-circuits before doing anything');
  assert.equal(await PucTransfer.countDocuments({ salesOrder: so._id, sourceType: 'sale' }), 1);
  assert.equal(await JournalEntry.countDocuments({ sourceType: 'SO', sourceId: so._id, accountingAction: 'SALES_PUC_CONSUMPTION' }), 1);
  assert.equal(await pucAccountBalance(wipRawMaterials._id, project._id), 300, 'balance was only reduced once');
});

test('a return releases exactly the returned quantity back to PUC, at the original sale unit cost, Dr PUC / Cr COGS', async () => {
  const product = await makeProduct();
  await purchaseIntoPuc(product, { quantity: 10, unitPrice: 50 }); // PUC 500
  const so = await makeSalesOrder([{ product, quantity: 6 }]); // sell 6 -> consumes 300, PUC left 200
  await consumePucForSale(so, { userId: manager._id });
  assert.equal(await pucAccountBalance(wipRawMaterials._id, project._id), 200);

  const entry = await releasePucConsumptionForReturn(so, product._id, 2, { userId: manager._id }); // return 2 of the 6
  assert.ok(entry);
  assert.equal(entry.accountingAction, 'SALES_PUC_CONSUMPTION_RETURN');
  const lines = entry.lines.map(l => [String(l.account), l.debit, l.credit]);
  assert.deepEqual(lines, [
    [String(wipRawMaterials._id), 100, 0], // 2 units @ 50 (the ORIGINAL sale's unit cost)
    [String(costRawMaterials._id), 0, 100],
  ]);
  assert.equal(await pucAccountBalance(wipRawMaterials._id, project._id), 300); // 200 + 100 released back

  const release = await PucTransfer.findOne({ salesOrder: so._id, sourceType: 'sale-return' }).lean();
  assert.equal(release.quantity, 2);
  assert.equal(release.unitCost, 50);
});

test('a return can never release more than this SAME order actually consumed for that product, even across multiple partial returns', async () => {
  const product = await makeProduct();
  await purchaseIntoPuc(product, { quantity: 10, unitPrice: 50 });
  const so = await makeSalesOrder([{ product, quantity: 6 }]);
  await consumePucForSale(so, { userId: manager._id }); // consumed 6

  await releasePucConsumptionForReturn(so, product._id, 4, { userId: manager._id }); // release 4, 2 still consumed
  const overReturn = await releasePucConsumptionForReturn(so, product._id, 10, { userId: manager._id }); // try to return 10 more - only 2 left to give back
  assert.ok(overReturn);
  const releases = await PucTransfer.find({ salesOrder: so._id, sourceType: 'sale-return' }).lean();
  assert.equal(releases.reduce((s, r) => s + r.quantity, 0), 6, 'total released never exceeds the 6 actually consumed');

  const thirdAttempt = await releasePucConsumptionForReturn(so, product._id, 1, { userId: manager._id });
  assert.equal(thirdAttempt, null, 'nothing left to release - a further attempt is a clean no-op, not an error');
});

test('a return for a product this order never actually consumed from PUC is a silent no-op', async () => {
  const neverConsumed = await makeProduct();
  const so = await makeSalesOrder([{ product: neverConsumed, quantity: 3 }]); // consumePucForSale was never even called
  const result = await releasePucConsumptionForReturn(so, neverConsumed._id, 3, { userId: manager._id });
  assert.equal(result, null);
  assert.equal(await PucTransfer.countDocuments({ salesOrder: so._id }), 0);
});

test('full cancellation (mirrorReverseEntry) fully restores the PUC balance for a multi-product order', async () => {
  const a = await makeProduct();
  const b = await makeProduct();
  await purchaseIntoPuc(a, { quantity: 10, unitPrice: 50 }); // 500
  await purchaseIntoPuc(b, { quantity: 10, unitPrice: 30 }); // 300
  const so = await makeSalesOrder([{ product: a, quantity: 4 }, { product: b, quantity: 5 }]); // consumes 200 + 150 = 350
  const entry = await consumePucForSale(so, { userId: manager._id });
  assert.equal(await pucAccountBalance(wipRawMaterials._id, project._id), 450); // 800 - 350

  await mirrorReverseEntry({ entryId: entry._id, date: new Date(), reason: 'Sales order cancelled', userId: manager._id });
  assert.equal(await pucAccountBalance(wipRawMaterials._id, project._id), 800, 'the whole consumption entry was mirrored - full balance restored');

  const reloaded = await PucTransfer.find({ salesOrder: so._id, sourceType: 'sale' }).populate({ path: 'journalEntry', select: 'status' }).lean();
  assert.ok(reloaded.every(r => r.journalEntry.status === 'reversed'));
});

test('JV0011 (project cost recognition) never double-counts what a SALES_PUC_CONSUMPTION entry already took - the shared real-PUC-balance cap', async () => {
  const { postProjectExecutionRecognitionJEs } = require('../../services/accounting/accountingEventService');
  const product = await makeProduct();
  await purchaseIntoPuc(product, { quantity: 10, unitPrice: 50 }); // PUC 500
  const so = await makeSalesOrder([{ product, quantity: 6 }]); // consumes 300 precisely
  await consumePucForSale(so, { userId: manager._id });
  assert.equal(await pucAccountBalance(wipRawMaterials._id, project._id), 200); // 500 - 300 left

  // Simulate the project's own cost-category budget wanting to recognize the FULL 500 (100% executed).
  // No revenue line configured, so postProjectRevenueRecognitionJE (the other half of this wrapper)
  // has nothing to post and no-ops - only the cost side is exercised here.
  const freshProject = await Project.findById(project._id);
  freshProject.averageCostLines = [{ account: costRawMaterials._id, amount: 500, recognizedAmount: 0 }];
  freshProject.executedPercentage = 100;
  freshProject.costRecognizedPercentage = 0;
  await freshProject.save();

  const entries = await postProjectExecutionRecognitionJEs(freshProject, undefined, so._id);
  const je = entries.find(e => e.accountingAction === 'PROJECT_COST_RECOGNITION');
  assert.ok(je);
  const pucLine = je.lines.find(l => String(l.account) === String(wipRawMaterials._id));
  assert.equal(pucLine.credit, 200, 'JV0011 only recognizes what is REALLY left in PUC (200), never the full 500 target - the 300 this sale already took is never double-credited');
  assert.equal(await pucAccountBalance(wipRawMaterials._id, project._id), 0);
});
