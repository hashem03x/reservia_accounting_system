const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// End-to-end acceptance scenarios for "project-specific inventory consumption": a Purchase Order
// linked to a project allocates straight into that project's PUC (never general warehouse
// inventory); a Sales Order for that project's materials consumes from the SAME project's PUC
// (services/inventory/pucSalesConsumptionService.js), never from general/another project's
// inventory. Exercises the real display-layer functions (getPucRawMaterialBalances,
// getProjectMaterialBreakdown) so the reported Total Inventory Amount is verified too, not just
// the raw PucTransfer ledger.

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_project_inventory_scenarios';

let Requisition, PurchaseOrder, SalesOrder, Vendor, Project, User, Warehouse, Product, Category, Brand, PucTransfer, ChartOfAccount, JournalEntry;
let allocatePurchaseOrderToProject, postPurchaseOrderJournalEntries, applyPurchaseToProducts;
let consumePucForSale, assertProjectStock, projectStockForForm, settings;
let getPucRawMaterialBalances, getProjectMaterialBreakdown;

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
  ({ postPurchaseOrderJournalEntries } = require('../../services/accounting/accountingEventService'));
  ({ applyPurchaseToProducts } = require('../../controller/PO/purchaseOrderController'));
  ({ consumePucForSale } = require('../../services/inventory/pucSalesConsumptionService'));
  ({ assertProjectStock, projectStockForForm } = require('../../services/inventory/projectStockService'));
  settings = require('../../services/config/companySettingsService');
  ({ getPucRawMaterialBalances, getProjectMaterialBreakdown } = require('../../services/inventory/pucMaterialBalanceService'));
  await Promise.all([Requisition.init(), PurchaseOrder.init(), SalesOrder.init(), Vendor.init(), Project.init(), Product.init(), PucTransfer.init(), ChartOfAccount.init(), JournalEntry.init()]);
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

let seq = 0;
let vendor, manager, customer, warehouse, category, brand;
const GENERAL_STOCK = 1000; // the product's starting, pre-existing warehouse stock (unrelated to any project)

beforeEach(async () => {
  await Promise.all(
    [
      'requisitions', 'purchaseorders', 'salesorders', 'vendors', 'projects', 'users', 'warehouses', 'products', 'categories', 'brands',
      'puctransfers', 'counters', 'chartofaccounts', 'journalentries',
    ].map(c => mongoose.connection.collection(c).deleteMany({}))
  );
  seq += 1;
  manager = await User.create({ name: 'Manager', email: `scn-manager-${seq}@example.com`, role: 'admin', type: 'online' });
  customer = await User.create({ name: 'Customer', email: `scn-customer-${seq}@example.com`, role: 'user', type: 'online', customerNumber: seq });
  vendor = await Vendor.create({ name: 'Scenario Vendor', contact: { phone: `010${Date.now()}${seq}`.slice(0, 11) } });
  warehouse = await Warehouse.create({ name: 'Scenario Warehouse', location: 'Cairo' });
  category = await Category.create({ name: { en: 'Materials', ar: 'مواد' } });
  brand = await Brand.create({ name: { en: 'ACME', ar: 'أكمي' } });
  await ChartOfAccount.create({ code: '11000009', name: 'PUC - Raw Materials', type: 'asset' });
  await ChartOfAccount.create({ code: '50000001', name: 'Raw Materials', type: 'cogs' });
  await ChartOfAccount.create({ code: '11000007', name: 'Materials Inventory', type: 'asset' });
  await ChartOfAccount.create({ code: '31000001', name: 'Suppliers - Construction Materials', type: 'liability' });
  await ChartOfAccount.create({ code: '11000017', name: 'Egyptian Tax Authority - VAT', type: 'asset' });
  await ChartOfAccount.create({ code: '31000010', name: 'VAT Payable', type: 'liability' });
  await ChartOfAccount.create({ code: '31000012', name: 'Withholding Taxes Payable', type: 'liability' });
});

async function makeProject(label) {
  seq += 1;
  return Project.create({ projectNumber: `SCN-${label}-${seq}`, projectManager: manager._id, startDate: new Date('2026-01-01'), deliveryDate: new Date('2026-12-31') });
}

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
    stock: [{ warehouse: warehouse._id, quantity: GENERAL_STOCK }],
    ...overrides,
  });
}

/** A real PO, linked to `project`, received and fully allocated to that project's PUC. */
async function purchaseForProject(project, product, { quantity, unitPrice }) {
  const requisition = await Requisition.create({ vendorId: vendor._id, project: project._id, items: [{ description: 'x', quantity: 1, unitPrice: 1000000 }] });
  requisition.status = 'open';
  await requisition.save();
  const invoice = await PurchaseOrder.create({ vendorId: vendor._id, warehouseId: warehouse._id, project: project._id, requisition: requisition._id, items: [{ productId: product._id, unitPrice, starterQuantity: quantity }] });
  // The REAL createPO controller sequence, exactly: receive into the warehouse (+quantity), post
  // the PO's own journal entries, then allocate the just-received quantity to the project's PUC
  // (-quantity) - net zero on Product.stock, which is what "general inventory remains unchanged"
  // actually verifies below (not merely trusting the allocation step in isolation).
  await applyPurchaseToProducts(invoice, String(warehouse._id), null);
  await postPurchaseOrderJournalEntries(invoice, null);
  await allocatePurchaseOrderToProject(invoice._id, { userId: manager._id, requireAvailableStock: false });
  return invoice;
}

/** A real SO, linked to `project`, selling `quantity` of `product` (consumed from that project's PUC). */
async function sellForProject(project, product, quantity) {
  const so = await SalesOrder.create({ customer: customer._id, warehouse: warehouse._id, orderSource: 'cashier', project: project._id, items: [{ product: product._id, unitPrice: 100, starterQuantity: quantity }] });
  await consumePucForSale(so, { userId: manager._id });
  return so;
}

async function remainingQuantity(project, product) {
  const balances = await getPucRawMaterialBalances({ project: String(project._id), product: String(product._id) });
  return balances.rows[0]?.closingQuantity ?? 0;
}

async function generalStockOf(product) {
  const fresh = await Product.findById(product._id).lean();
  return fresh.stock.find(s => String(s.warehouse) === String(warehouse._id))?.quantity ?? 0;
}

// =============================== Scenario A — basic purchase and sale ===============================

test('Scenario A: purchase 100, sell 30 -> project inventory 70, general inventory unchanged, correct JEs', async () => {
  const project = await makeProject('A');
  const product = await makeProduct();

  await purchaseForProject(project, product, { quantity: 100, unitPrice: 50 });
  assert.equal(await remainingQuantity(project, product), 100);
  assert.equal(await generalStockOf(product), GENERAL_STOCK, 'general inventory is untouched by a project purchase');

  const so = await sellForProject(project, product, 30);
  assert.equal(await remainingQuantity(project, product), 70);
  assert.equal(await generalStockOf(product), GENERAL_STOCK, 'general inventory is untouched by a project sale too');

  const consumptionEntry = await JournalEntry.findOne({ sourceType: 'SO', sourceId: so._id, accountingAction: 'SALES_PUC_CONSUMPTION' }).lean();
  assert.ok(consumptionEntry, 'a COGS/PUC journal entry was posted for the sale');
  const costAccount = await ChartOfAccount.findOne({ code: '50000001' }).lean();
  const pucAccount = await ChartOfAccount.findOne({ code: '11000009' }).lean();
  const lines = consumptionEntry.lines.map(l => [String(l.account?._id || l.account), l.debit, l.credit]);
  assert.deepEqual(lines, [
    [String(costAccount._id), 1500, 0], // 30 units x 50
    [String(pucAccount._id), 0, 1500],
  ]);

  const receiptEntries = await JournalEntry.countDocuments({ sourceType: 'PO', accountingAction: 'PO_INVENTORY_TO_WIP' });
  assert.equal(receiptEntries, 1, 'the purchase side posted its own inventory-to-WIP entry too');
});

// =============================== Scenario B — multiple purchases ===============================

test('Scenario B: two POs (100 + 50) for the same project, sell 60 -> remaining 90', async () => {
  const project = await makeProject('B');
  const product = await makeProduct();

  await purchaseForProject(project, product, { quantity: 100, unitPrice: 50 });
  await purchaseForProject(project, product, { quantity: 50, unitPrice: 50 });
  assert.equal(await remainingQuantity(project, product), 150);

  await sellForProject(project, product, 60);
  assert.equal(await remainingQuantity(project, product), 90);
});

// =============================== Scenario C — partial sales ===============================

test('Scenario C: purchase 100, sell 30, sell 20 -> remaining 50', async () => {
  const project = await makeProject('C');
  const product = await makeProduct();

  await purchaseForProject(project, product, { quantity: 100, unitPrice: 50 });
  await sellForProject(project, product, 30);
  assert.equal(await remainingQuantity(project, product), 70);
  await sellForProject(project, product, 20);
  assert.equal(await remainingQuantity(project, product), 50);
});

// =============================== Scenario D — multiple projects, no cross-consumption ===============================

test('Scenario D: Project A (100) and Project B (150), sell 40 from A -> A=60, B=150, no cross-project consumption', async () => {
  const projectA = await makeProject('D-A');
  const projectB = await makeProject('D-B');
  const product = await makeProduct(); // the SAME product, purchased separately into two different projects

  await purchaseForProject(projectA, product, { quantity: 100, unitPrice: 50 });
  await purchaseForProject(projectB, product, { quantity: 150, unitPrice: 50 });
  assert.equal(await remainingQuantity(projectA, product), 100);
  assert.equal(await remainingQuantity(projectB, product), 150);

  await sellForProject(projectA, product, 40);
  assert.equal(await remainingQuantity(projectA, product), 60);
  assert.equal(await remainingQuantity(projectB, product), 150, "Project B's inventory is completely untouched by Project A's sale");
});

// =============================== Scenario E — inventory valuation / average cost ===============================

test('Scenario E: purchases at different unit costs -> weighted average cost and COGS follow the existing Average Cost methodology', async () => {
  const project = await makeProject('E');
  const product = await makeProduct();

  await purchaseForProject(project, product, { quantity: 100, unitPrice: 40 }); // 100 @ 40 = 4,000
  await purchaseForProject(project, product, { quantity: 100, unitPrice: 60 }); // 100 @ 60 = 6,000
  // Weighted average = (4,000 + 6,000) / 200 = 50
  const beforeSale = await getPucRawMaterialBalances({ project: String(project._id), product: String(product._id) });
  assert.equal(beforeSale.rows[0].averageUnitCost, 50);
  assert.equal(beforeSale.rows[0].closingValue, 10000);

  const so = await sellForProject(project, product, 50); // sold at the weighted average cost
  const after = await getPucRawMaterialBalances({ project: String(project._id), product: String(product._id) });
  assert.equal(after.rows[0].closingQuantity, 150);
  assert.equal(after.rows[0].closingValue, 7500); // 10,000 - (50 x 50)
  assert.equal(after.rows[0].averageUnitCost, 50, 'the cost BASIS (weighted average of receipts) is unaffected by how much has been sold');

  const entry = await JournalEntry.findOne({ sourceType: 'SO', sourceId: so._id, accountingAction: 'SALES_PUC_CONSUMPTION' }).lean();
  assert.equal(entry.lines.find(l => l.debit > 0).debit, 2500); // COGS = 50 units x 50 (average cost)

  // Total Inventory Amount is visible via BOTH display-layer endpoints used by the frontend.
  const breakdown = await getProjectMaterialBreakdown(project._id);
  assert.equal(breakdown.totals.closingValue, 7500);
  assert.equal(breakdown.totals.consumedValue, 2500);
  assert.equal(breakdown.totals.purchasedQuantity, 200);
});

// =============================== Negative guards: no negative balance, no double consumption ===============================

test('ERP CHG-03: selling more than the project holds is refused by default; an allowed oversell is fully costed; consuming twice never double-counts', async () => {
  const project = await makeProject('GUARD');
  const product = await makeProduct();
  await purchaseForProject(project, product, { quantity: 10, unitPrice: 50 });

  await assert.rejects(() => assertProjectStock({ projectId: project._id, items: [{ product: product._id, starterQuantity: 1000 }] }), /Only 10 available for this project/);

  // Override path (e.g. the product may go negative): the whole quantity is costed.
  const so = await sellForProject(project, product, 1000);
  assert.equal(await remainingQuantity(project, product), -990, 'the shortfall shows on the project inventory');

  await consumePucForSale(so, { userId: manager._id }); // a repeated/duplicate call
  assert.equal(await remainingQuantity(project, product), -990, 'unchanged - the idempotency guard prevented a second consumption');
  assert.equal(await PucTransfer.countDocuments({ salesOrder: so._id, sourceType: 'sale' }), 1);
});

test('ERP CHG-03 acceptance: project stock 40 - a sale of 50 is refused with a message, a sale of 40 saves, stock shows 0', async () => {
  const project = await makeProject('CHG03');
  const product = await makeProduct();
  await purchaseForProject(project, product, { quantity: 60, unitPrice: 50 });
  await sellForProject(project, product, 20);
  assert.equal(await remainingQuantity(project, product), 40);

  const [line] = await projectStockForForm(project._id, [String(product._id)]);
  assert.deepEqual(line, { product: String(product._id), tracked: true, available: 40, enforced: true }, 'what the sales form shows');

  // Summed per product across lines: 30 + 20 = 50 > 40.
  await assert.rejects(
    () => assertProjectStock({ projectId: project._id, items: [{ product: product._id, starterQuantity: 30 }, { product: product._id, starterQuantity: 20 }] }),
    err => err.statusCode === 400 && /Only 40 available for this project/.test(err.message)
  );
  await assertProjectStock({ projectId: project._id, items: [{ product: product._id, starterQuantity: 40 }] });
  const so = await sellForProject(project, product, 40);
  assert.equal(await remainingQuantity(project, product), 0);
  const transfer = await PucTransfer.findOne({ salesOrder: so._id, sourceType: 'sale' }).lean();
  assert.equal(transfer.amount, 2000, 'cost for all 40 units');
});

test('ERP CHG-03: the company setting and the per-product override lift the limit; services and untracked products are never blocked', async () => {
  const project = await makeProject('CHG03B');
  const product = await makeProduct();
  await purchaseForProject(project, product, { quantity: 10, unitPrice: 50 });
  const tooMany = [{ product: product._id, starterQuantity: 11 }];
  await assert.rejects(() => assertProjectStock({ projectId: project._id, items: tooMany }), /Only 10 available/);

  await settings.updateCompanySettings({ preventNegativeProjectStock: false }, null);
  await assertProjectStock({ projectId: project._id, items: tooMany });
  assert.equal((await projectStockForForm(project._id, [String(product._id)]))[0].enforced, false);
  await settings.updateCompanySettings({ preventNegativeProjectStock: true }, null);

  await Product.updateOne({ _id: product._id }, { $set: { allowNegativeProjectStock: true } });
  await assertProjectStock({ projectId: project._id, items: tooMany });

  const untracked = await makeProduct();
  await assertProjectStock({ projectId: project._id, items: [{ product: untracked._id, starterQuantity: 5 }] });
});

test('ERP CHG-01: the WIP reconciliation agrees for a plain project and flags the AGR-0000003 pattern (two relief mechanisms, negative WIP)', async () => {
  const { wipStockReconciliation } = require('../../services/reports/wipStockReconciliationReport'); // eslint-disable-line global-require
  const project = await makeProject('REC');
  const product = await makeProduct();
  await purchaseForProject(project, product, { quantity: 1000, unitPrice: 6.7 });
  await sellForProject(project, product, 1000);

  let report = await wipStockReconciliation({});
  let row = report.sections[0].rows.find(r => r.projectId === String(project._id));
  assert.equal(row.costAdded, 6700);
  assert.equal(row.relievedUnits, 6700);
  assert.equal(row.glWip, 0);
  assert.equal(row.stockValue, 0);
  assert.equal(row.ok, true, row.status);

  // The % executed mechanism relieves the same goods again (ledger only), as on AGR-0000003.
  const wip = await ChartOfAccount.findOne({ code: '11000009' });
  const cogs = await ChartOfAccount.findOne({ code: '50000001' });
  await JournalEntry.create({
    entryNumber: 990001, date: new Date(), description: 'Charge project with costs by executed % of contract', status: 'posted', source: 'automatic',
    accountingAction: 'PROJECT_COST_RECOGNITION', sourceType: 'PROJECT', sourceId: String(project._id), project: project._id,
    lines: [{ account: cogs._id, debit: 6700, credit: 0, project: project._id, projectNumber: project.projectNumber }, { account: wip._id, debit: 0, credit: 6700, project: project._id, projectNumber: project.projectNumber }],
  });
  report = await wipStockReconciliation({});
  row = report.sections[0].rows.find(r => r.projectId === String(project._id));
  assert.equal(row.relievedPercent, 6700);
  assert.equal(row.glWip, -6700);
  assert.equal(row.difference, -6700);
  assert.equal(row.ok, false);
  for (const flag of ['Negative WIP', 'Relieved more than added', 'Two cost mechanisms', 'Ledger and stock differ']) assert.ok(row.status.includes(flag), flag);
  assert.equal(report.checks.every(c => c.ok), false);
});
