const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Warehouses -> PUC - Raw Materials balances (projectwise) and the project raw-material breakdown
// (services/inventory/pucMaterialBalanceService.js): derived from the authoritative PUC allocation
// records and the PUC - Raw Materials ledger, reconciled, never double-counted, and always equal to
// the quantity PUC transfers are validated against (pucTransferService.js#projectQuantity).

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_puc_material_balances';

let Requisition, PurchaseOrder, Vendor, Project, User, Warehouse, Product, PucTransfer, JournalEntry, ChartOfAccount;
let allocatePurchaseOrderToProject, projectQuantity, getPucRawMaterialBalances, getProjectMaterialBreakdown;
let vendor, manager, warehouse, warehouse2, projectA, projectB, pucRaw, cable, pipe;

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
  PucTransfer = require('../../models/inventory/pucTransferModel');
  JournalEntry = require('../../models/accounting/journalEntryModel');
  ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
  ({ allocatePurchaseOrderToProject } = require('../../services/inventory/poProjectAllocationService'));
  ({ projectQuantity } = require('../../services/inventory/pucTransferService'));
  ({ getPucRawMaterialBalances, getProjectMaterialBreakdown } = require('../../services/inventory/pucMaterialBalanceService'));
  await Promise.all([Requisition.init(), PurchaseOrder.init(), Vendor.init(), Project.init(), Product.init(), PucTransfer.init()]);
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

let seq = 0;
beforeEach(async () => {
  await Promise.all(
    ['requisitions', 'purchaseorders', 'vendors', 'projects', 'users', 'warehouses', 'products', 'puctransfers', 'counters', 'journalentries', 'chartofaccounts'].map(c => mongoose.connection.collection(c).deleteMany({}))
  );
  seq += 1;
  manager = await User.create({ name: 'PUC Manager', email: `puc-${seq}@example.com`, role: 'admin', type: 'online' });
  vendor = await Vendor.create({ name: 'PUC Vendor', contact: { phone: `012${Date.now()}${seq}`.slice(0, 11) } });
  projectA = await Project.create({ projectNumber: `PUC-A-${seq}`, projectManager: manager._id, startDate: new Date('2026-01-01'), deliveryDate: new Date('2026-12-31') });
  projectB = await Project.create({ projectNumber: `PUC-B-${seq}`, projectManager: manager._id, startDate: new Date('2026-01-01'), deliveryDate: new Date('2026-12-31') });
  warehouse = await Warehouse.create({ name: 'Main', location: 'Cairo' });
  warehouse2 = await Warehouse.create({ name: 'Second', location: 'Giza' });
  pucRaw = await ChartOfAccount.create({ code: '11000009', name: 'PUC - Raw Materials', type: 'asset' });
  const base = { type: 'product', description: { en: 'd', ar: 'د' }, category: new mongoose.Types.ObjectId(), brand: new mongoose.Types.ObjectId() };
  cable = await Product.create({ ...base, title: { en: `Cable ${seq}`, ar: `كابل ${seq}` }, model: 'CX-1', stock: [{ warehouse: warehouse._id, quantity: 100 }, { warehouse: warehouse2._id, quantity: 100 }] });
  pipe = await Product.create({ ...base, title: { en: `Pipe ${seq}`, ar: `ماسورة ${seq}` }, model: 'PP-2', stock: [{ warehouse: warehouse._id, quantity: 100 }] });
});

async function invoice(project, product, { quantity, unitPrice, wh = warehouse, date = '2026-03-01' }) {
  const requisition = await Requisition.create({ vendorId: vendor._id, project: project._id, items: [{ product: product._id, description: 'x', quantity: 1, unitPrice: 1000000 }], status: 'open' });
  const inv = await PurchaseOrder.create({ vendorId: vendor._id, warehouseId: wh._id, project: project._id, requisition: requisition._id, items: [{ productId: product._id, unitPrice, starterQuantity: quantity }] });
  await allocatePurchaseOrderToProject(inv._id, { userId: manager._id });
  await PucTransfer.updateMany({ purchaseOrder: inv._id }, { $set: { date: new Date(date) } });
  return inv;
}
const pucLine = (project, debit, credit) => ({ account: pucRaw._id, project: project._id, debit, credit, description: 'x' });
const rowOf = (result, project, product) => result.rows.find(r => String(r.project._id) === String(project._id) && String(r.product._id) === String(product._id));

test('balances per project x material: several invoices for one material add up, each traceable; other projects are separate', async () => {
  const inv1 = await invoice(projectA, cable, { quantity: 10, unitPrice: 50 });
  const inv2 = await invoice(projectA, cable, { quantity: 5, unitPrice: 60 });
  await invoice(projectB, pipe, { quantity: 4, unitPrice: 25 });

  const result = await getPucRawMaterialBalances({});
  assert.equal(result.rows.length, 2);
  const a = rowOf(result, projectA, cable);
  assert.deepEqual([a.purchasedQuantity, a.purchasedValue, a.closingQuantity, a.closingValue], [15, 800, 15, 800]);
  assert.equal(a.averageUnitCost, 53.33);
  assert.equal(rowOf(result, projectB, pipe).closingValue, 100);

  const breakdown = await getProjectMaterialBreakdown(projectA._id);
  assert.equal(breakdown.materials.length, 1);
  const [material] = breakdown.materials;
  assert.equal(material.purchaseInvoices, 2);
  assert.deepEqual(material.sources.map(s => [String(s.invoice._id), s.quantity, s.unitCost, s.amount, s.invoice.vendor.name]), [
    [String(inv1._id), 10, 50, 500, 'PUC Vendor'],
    [String(inv2._id), 5, 60, 300, 'PUC Vendor'],
  ]);
  assert.equal(await projectQuantity(cable._id, projectA._id), material.closingQuantity, 'same quantity as the PUC transfer rule');
});

test('transfers between projects, a reversed transfer and a purchase return are counted exactly once, on the right project', async () => {
  await invoice(projectA, cable, { quantity: 10, unitPrice: 50 });
  const posted = await JournalEntry.collection.insertOne({ entryNumber: 1, status: 'posted', lines: [] });
  const reversed = await JournalEntry.collection.insertOne({ entryNumber: 2, status: 'reversed', lines: [] });
  const transfer = extra => PucTransfer.create({ product: cable._id, quantity: 3, unitCost: 50, amount: 150, sourceType: 'project', sourceProject: projectA._id, project: projectB._id, date: new Date('2026-04-01'), ...extra });
  await transfer({ journalEntry: posted.insertedId });
  await transfer({ journalEntry: reversed.insertedId }); // reversed - must not count
  await PucTransfer.create({ product: cable._id, quantity: 2, unitCost: 50, amount: 100, sourceType: 'purchase-return', project: projectA._id, date: new Date('2026-04-02') });

  const result = await getPucRawMaterialBalances({});
  const a = rowOf(result, projectA, cable);
  const b = rowOf(result, projectB, cable);
  assert.deepEqual([a.purchasedQuantity, a.transferredOutQuantity, a.returnedQuantity, a.closingQuantity], [10, 3, 2, 5]);
  assert.deepEqual([b.transferredInQuantity, b.closingQuantity, b.closingValue], [3, 3, 150]);
  assert.equal(result.totals.closingValue, 400, 'company-wide: the reallocation moves value, it does not create any');
  assert.equal(await projectQuantity(cable._id, projectA._id), 5);
  assert.equal(await projectQuantity(cable._id, projectB._id), 3);
});

test('date range: opening / movements / closing; warehouse and project filters', async () => {
  await invoice(projectA, cable, { quantity: 10, unitPrice: 50, date: '2026-01-15' });
  await invoice(projectA, cable, { quantity: 4, unitPrice: 50, wh: warehouse2, date: '2026-05-10' });

  const ranged = rowOf(await getPucRawMaterialBalances({ dateFrom: '2026-05-01', dateTo: '2026-05-31' }), projectA, cable);
  assert.deepEqual([ranged.openingQuantity, ranged.purchasedQuantity, ranged.closingQuantity], [10, 4, 14]);
  const upToApril = rowOf(await getPucRawMaterialBalances({ dateTo: '2026-04-30' }), projectA, cable);
  assert.equal(upToApril.closingQuantity, 10);

  const second = await getPucRawMaterialBalances({ warehouse: String(warehouse2._id) });
  assert.equal(rowOf(second, projectA, cable).closingQuantity, 4);
  assert.equal((await getPucRawMaterialBalances({ project: String(projectB._id) })).rows.length, 0);
  await assert.rejects(() => getPucRawMaterialBalances({ dateFrom: '2026-06-01', dateTo: '2026-05-01' }), /start date/);
});

test('each project reconciles its allocated material value with its PUC - Raw Materials ledger (value relieved by cost recognition shown as the difference)', async () => {
  await invoice(projectA, cable, { quantity: 10, unitPrice: 50 });
  await JournalEntry.collection.insertMany([
    { entryNumber: 10, status: 'posted', date: new Date('2026-03-01'), lines: [pucLine(projectA, 500, 0)] },
    { entryNumber: 11, status: 'posted', date: new Date('2026-03-20'), lines: [pucLine(projectA, 0, 120)] }, // cost recognition (JV0011)
    { entryNumber: 12, status: 'draft', date: new Date('2026-03-21'), lines: [pucLine(projectA, 0, 999)] }, // drafts never count
  ]);
  const result = await getPucRawMaterialBalances({});
  const [summary] = result.projects;
  assert.deepEqual(summary.ledger, { opening: 0, debit: 500, credit: 120, closing: 380 });
  assert.equal(summary.closingValue, 500);
  assert.equal(summary.differenceToLedger, -120);
  assert.equal(result.totals.ledgerClosing, 380);
});

test('project breakdown: Purchase Order (committed) quantities are shown separately, never added to the purchased (actual) quantity', async () => {
  await invoice(projectA, cable, { quantity: 10, unitPrice: 50 });
  await Requisition.create({ vendorId: vendor._id, project: projectA._id, status: 'open', items: [{ product: pipe._id, description: 'Pipe', quantity: 20, unit: 'm', unitPrice: 30 }] });

  const breakdown = await getProjectMaterialBreakdown(projectA._id);
  const cableRow = breakdown.materials.find(m => String(m.product._id) === String(cable._id));
  const pipeRow = breakdown.materials.find(m => String(m.product._id) === String(pipe._id));
  assert.equal(pipeRow.purchasedQuantity, 0, 'ordered, not purchased');
  assert.deepEqual([pipeRow.ordered.quantity, pipeRow.ordered.amount, pipeRow.ordered.units], [20, 600, ['m']]);
  assert.equal(cableRow.purchasedQuantity, 10);
  assert.ok(cableRow.ordered === null || cableRow.ordered.quantity >= 0);
  assert.equal(breakdown.totals.purchasedValue, 500);
});

test('BOQ price vs PO cost: (BOQ unit price - actual purchase unit cost) x BOQ quantity; committed cost separate; missing data never becomes zero; foreign BOQ prices converted; nothing posted', async () => {
  const Currency = require('../../models/accounting/currencyModel');
  await Currency.deleteMany({});
  await Currency.create({ code: 'USD', name: 'US Dollar', unitsPerBase: 0.02, rateEffectiveDate: new Date('2020-01-01'), rateHistory: [{ unitsPerBase: 0.02, effectiveDate: new Date('2020-01-01') }] });
  const valve = await Product.create({ type: 'product', title: { en: `Valve ${seq}`, ar: `صمام ${seq}` }, description: { en: 'd', ar: 'د' }, category: new mongoose.Types.ObjectId(), brand: new mongoose.Types.ObjectId(), stock: [{ warehouse: warehouse._id, quantity: 10 }] });

  await invoice(projectA, cable, { quantity: 10, unitPrice: 50 }); // 500
  await invoice(projectA, cable, { quantity: 10, unitPrice: 70 }); // 700 -> actual unit cost 60
  await Requisition.create({ vendorId: vendor._id, project: projectA._id, status: 'open', items: [{ product: pipe._id, description: 'Pipe', quantity: 20, unit: 'pcs', unitPrice: 30 }] });
  await Project.updateOne(
    { _id: projectA._id },
    {
      $set: {
        boqLines: [
          { product: cable._id, quantity: 30, unit: 'm', unitPrice: 100, currency: 'EGP' },
          { product: pipe._id, quantity: 20, unit: 'm', unitPrice: 2, currency: 'USD' }, // 2 USD = 100 EGP (1 EGP = 0.02 USD)
        ],
      },
    }
  );
  const entriesBefore = await JournalEntry.countDocuments({});

  const breakdown = await getProjectMaterialBreakdown(projectA._id);
  const row = product => breakdown.materials.find(m => String(m.product._id) === String(product._id));

  const c = row(cable);
  assert.equal(c.boq.unitPriceEgp, 100, 'the project BOQ price, not the catalog price or the PO cost');
  assert.equal(c.purchaseUnitCost, 60, 'actual purchase cost from the Purchase Invoice lines (several invoices averaged)');
  assert.deepEqual([c.contribution.status, c.contribution.unitDifference, c.contribution.quantityBasis, c.contribution.total], ['ok', 40, 30, 1200]);
  assert.equal(c.purchasedQuantity, 20, 'purchased quantity shown separately from the BOQ quantity');

  const p = row(pipe);
  assert.equal(p.boq.unitPriceEgp, 100, 'USD BOQ price converted with the Currency Manager rule');
  assert.equal(p.committedUnitCost, 30, 'committed (Purchase Order) cost is shown...');
  assert.equal(p.purchaseUnitCost, null, '...but never used as the actual cost');
  assert.deepEqual([p.contribution.status, p.contribution.total], ['missing_cost', null], 'missing cost is reported, never zero');
  assert.equal(p.contribution.unitMismatch, true, 'BOQ unit m vs PO unit pcs is flagged');

  // A purchased material with no BOQ line.
  await invoice(projectA, valve, { quantity: 2, unitPrice: 10 });
  const after = await getProjectMaterialBreakdown(projectA._id);
  assert.equal(after.materials.find(m => String(m.product._id) === String(valve._id)).contribution.status, 'missing_boq');
  assert.equal(after.totals.contribution, 1200, 'only complete lines are summed');
  assert.deepEqual([after.totals.contributionLines, after.totals.missingCostLines, after.totals.missingBoqLines], [1, 1, 1]);
  assert.equal(after.totals.boqValue, 30 * 100 + 20 * 100);
  assert.equal(await JournalEntry.countDocuments({}), entriesBefore, 'the analysis never posts anything');
});

test('data quality: PUC - Raw Materials ledger lines without a project are reported, never assigned to a project', async () => {
  await JournalEntry.collection.insertMany([
    { entryNumber: 20, status: 'posted', date: new Date('2026-03-01'), lines: [{ account: pucRaw._id, project: null, debit: 75, credit: 0 }] },
    { entryNumber: 21, status: 'posted', date: new Date('2026-03-02'), lines: [pucLine(projectA, 10, 0)] },
  ]);
  const { dataQuality } = await getPucRawMaterialBalances({});
  assert.deepEqual([dataQuality.ledgerLinesWithoutProject, dataQuality.ledgerAmountWithoutProject, dataQuality.sampleEntryNumbers], [1, 75, [20]]);
});
