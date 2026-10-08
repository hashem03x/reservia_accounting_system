const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Cumulative Sales Order Cost Recognition (accountingEventService.js#recognizeProjectSalesOrderCosts),
// run through the real creation/cancel paths: every order is kept at Cost of Items x the project's
// ACCUMULATED Executed %, posting only the difference (decreases through reversals). Also: orders are
// created without a payment method or shipping cost, every JE line carries the Sub Account, and
// documents can be attached to existing Sales/Purchase Orders.

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_so_cost_recognition';

const { AutomaticJournalAccountCodes, SalesOrderJournalDescriptions } = require('../../utils/accountingConstants');

const C = AutomaticJournalAccountCodes;

let Warehouse, SalesOrder, PurchaseOrder, Product, Project, User, Vendor, ChartOfAccount, JournalEntry;
let createSalesOrder, recognizeProjectSalesOrderCosts, recalculateExecutedPercentage, createOrderDocumentHandlers;
let transactionsSupported = true;
let warehouse, customer, manager, project, product, service, accounts;

const idStr = ref => String(ref?._id || ref);
const codeOf = accountId => Object.keys(accounts).find(code => idStr(accounts[code]) === idStr(accountId));

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  // Warehouse before Payment (see orderTaxAndPayment.test.js for the circular-require note).
  Warehouse = require('../../models/inventory/warehouseModel');
  SalesOrder = require('../../models/sales/salesOrderModel');
  PurchaseOrder = require('../../models/vendor/purchaseOrder');
  require('../../models/vendor/paymentModel');
  Product = require('../../models/inventory/productModel');
  Project = require('../../models/project/projectModel');
  User = require('../../models/userModel');
  Vendor = require('../../models/vendor/vendor');
  ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
  JournalEntry = require('../../models/accounting/journalEntryModel');
  ({ createSalesOrder } = require('../../services/sales/salesOrderCreation.service'));
  ({ recognizeProjectSalesOrderCosts } = require('../../services/accounting/accountingEventService'));
  ({ recalculateExecutedPercentage } = require('../../services/project/projectAccountingService'));
  ({ createOrderDocumentHandlers } = require('../../controller/orderDocumentController'));
  await Promise.all([SalesOrder.init(), PurchaseOrder.init(), Product.init(), Project.init(), ChartOfAccount.init(), JournalEntry.init()]);

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

beforeEach(async () => {
  await Promise.all(
    [Warehouse, SalesOrder, PurchaseOrder, Product, Project, User, Vendor, ChartOfAccount, JournalEntry].map(M => M.deleteMany({}))
  );
  accounts = {};
  const codeToType = {
    [AutomaticJournalAccountCodes.accountsReceivableProjects]: 'asset',
    [AutomaticJournalAccountCodes.revenue]: 'revenue',
    [AutomaticJournalAccountCodes.vatPayable]: 'liability',
    [AutomaticJournalAccountCodes.withholdingTaxReceivable]: 'asset',
    [AutomaticJournalAccountCodes.materialsInventory]: 'asset',
    [C.wipRawMaterials]: 'asset',
    [C.wipEngineeringDesign]: 'asset',
    [C.wipLabourWages]: 'asset',
    [C.costRawMaterials]: 'cogs',
    [C.costEngineeringDesign]: 'cogs',
    [C.costLabourWages]: 'cogs',
  };
  for (const [code, type] of Object.entries(codeToType)) {
    accounts[code] = await ChartOfAccount.create({ code, name: `Account ${code}`, type });
  }
  warehouse = await Warehouse.create({ name: 'Cost Warehouse', location: 'Cairo' });
  manager = await User.create({ name: 'Cost Manager', email: `cost-mgr-${Date.now()}@example.com`, role: 'admin', type: 'online' });
  customer = await User.create({ name: 'Cost Customer', email: `cost-cust-${Date.now()}@example.com`, role: 'user', type: 'online' });
  project = await Project.create({
    projectNumber: `PRJ-COST-${Date.now()}`,
    contractValue: 1000000,
    customer: customer._id,
    startDate: new Date(),
    deliveryDate: new Date(Date.now() + 86400000),
  });
  product = await Product.create({
    type: 'product',
    title: { en: 'Panel', ar: 'لوح' },
    description: { en: 'd', ar: 'د' },
    price: 2000,
    cost: 4000,
    category: new mongoose.Types.ObjectId(),
    subcategory: new mongoose.Types.ObjectId(),
    stock: [{ warehouse: warehouse._id, quantity: 1000 }],
  });
  const puc = await ChartOfAccount.create({ code: 'PUC-COST', name: 'PUC', type: 'asset' });
  service = await Product.create({ type: 'service', title: { en: 'Install', ar: 'تركيب' }, description: { en: 'd', ar: 'د' }, price: 5000, durationValue: 1, durationUnit: 'month', pucAccount: puc._id });
});

const sell = (items, taxes = {}) =>
  createSalesOrder({
    ...taxes,
    customer: customer._id,
    warehouse: warehouse._id.toString(),
    project: project._id,
    items,
    createdBy: manager._id,
    employee: manager._id,
  });

const PANEL = (quantity, unitPrice = 2000) => ({ product: product._id, unitPrice, starterQuantity: quantity }); // cost 4,000 each
const recognitionOf = async order => (await SalesOrder.findById(order._id).lean()).costRecognition;
const costEntriesOf = order => JournalEntry.find({ accountingAction: 'SO_COST_RECOGNITION', triggeredBySalesOrder: order._id }).sort({ entryNumber: 1 }).lean();
const activeTotal = entries => entries.filter(e => e.status === 'posted' && !e.reversedByEntry).reduce((sum, e) => sum + e.totalDebit, 0);

function assertEntryIntegrity(entry) {
  assert.equal(entry.totalDebit, entry.totalCredit, `JE #${entry.entryNumber} balances`);
  for (const line of entry.lines) {
    assert.equal(line.partyNumber, customer.customerNumber, 'Sub Account on every line');
    assert.equal(line.partyType, 'customer');
    assert.equal(line.projectNumber, project.projectNumber, 'Project Number on every line');
    assert.equal(line.description, entry.description, 'every line inherits the entry description');
    assert.ok(line.debit >= 0 && line.credit >= 0, 'never a negative amount');
  }
}

test('Scenario A: a Sales Order with no payment method and no shipping cost is created', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  const order = await sell([PANEL(100)]);
  const stored = await SalesOrder.findById(order._id).lean();
  assert.equal(stored.paymentMethod, null);
  assert.equal(stored.shippingCost, 0);
  assert.equal(stored.grandTotal, 200000, 'order total does not include shipping');
});

test('accumulation: 20% -> 30% -> 40% recognizes only the difference for every order, never twice', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');

  // Step 1 - Order A: 100 x 2,000 = 200,000 sales on a 1,000,000 contract -> 20%; cost 400,000.
  const orderA = await sell([PANEL(100)]);
  let a = await recognitionOf(orderA);
  assert.deepEqual(
    { pct: a.executedPercentage, cost: a.costOfItems, total: a.totalRecognizedCost, previous: a.previouslyRecognizedCost, current: a.currentRecognition },
    { pct: 20, cost: 400000, total: 80000, previous: 0, current: 80000 }
  );
  assert.deepEqual((await costEntriesOf(orderA)).map(e => e.totalDebit), [80000]);

  // Step 2 - Order B: 50 x 2,000 = 100,000 more -> 30%. A: 120,000 required, 80,000 already -> +40,000.
  const orderB = await sell([PANEL(50)]);
  a = await recognitionOf(orderA);
  assert.deepEqual({ pct: a.executedPercentage, total: a.totalRecognizedCost, previous: a.previouslyRecognizedCost, current: a.currentRecognition }, { pct: 30, total: 120000, previous: 80000, current: 40000 });
  assert.deepEqual((await costEntriesOf(orderA)).map(e => e.totalDebit), [80000, 40000], 'A got 40,000 - not another 80,000 or 120,000');
  const b = await recognitionOf(orderB);
  assert.deepEqual({ pct: b.executedPercentage, cost: b.costOfItems, total: b.totalRecognizedCost }, { pct: 30, cost: 200000, total: 60000 }, 'B: 30% x 200,000');

  // Step 3 - Order C: 50 x 2,000 = 100,000 more -> 40%. A: 160,000 total (+40,000); B: 80,000 (+20,000).
  const orderC = await sell([PANEL(50)]);
  a = await recognitionOf(orderA);
  assert.deepEqual({ pct: a.executedPercentage, total: a.totalRecognizedCost, previous: a.previouslyRecognizedCost, current: a.currentRecognition }, { pct: 40, total: 160000, previous: 120000, current: 40000 });
  const aEntries = await costEntriesOf(orderA);
  assert.deepEqual(aEntries.map(e => e.totalDebit), [80000, 40000, 40000]);
  assert.equal(activeTotal(aEntries), 160000, 'A cumulative 160,000 - not 80,000 + 120,000 + 160,000');
  assert.equal((await recognitionOf(orderB)).totalRecognizedCost, 80000);
  assert.equal(activeTotal(await costEntriesOf(orderB)), 80000);
  assert.equal((await recognitionOf(orderC)).totalRecognizedCost, 80000, 'C: 40% x 200,000');

  // Every entry balances and carries the Project Number, Sub Account and description on each line.
  for (const entry of await JournalEntry.find({ accountingAction: 'SO_COST_RECOGNITION' }).lean()) {
    assertEntryIntegrity(entry);
    assert.equal(entry.description, SalesOrderJournalDescriptions.costRecognition, 'JV0011 description from the sheet');
    assert.deepEqual(
      entry.lines.map(l => [codeOf(l.account), l.debit, l.credit]),
      [
        [C.wipRawMaterials, entry.totalDebit, 0],
        [C.costRawMaterials, 0, entry.totalDebit],
      ],
      'JV0011: Dr 11000009 WIP - Raw Materials / Cr 50000001 Raw Materials'
    );
  }
  assert.equal((await Project.findById(project._id)).executedPercentage, 40);
});

test('retries are idempotent: re-running recognition at the same state posts nothing', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  const order = await sell([PANEL(100)]);
  const before = await JournalEntry.countDocuments({ accountingAction: 'SO_COST_RECOGNITION' });

  for (let i = 0; i < 3; i++) await recognizeProjectSalesOrderCosts(project._id, null);
  const session = await mongoose.startSession();
  await session.withTransaction(() => recognizeProjectSalesOrderCosts(project._id, session));
  session.endSession();

  assert.equal(await JournalEntry.countDocuments({ accountingAction: 'SO_COST_RECOGNITION' }), before);
  assert.equal((await recognitionOf(order)).totalRecognizedCost, 80000);
});

test('concurrent requests cannot both post the same increment', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  const order = await sell([PANEL(100)]); // 20% -> 80,000
  // The project moves to 50% (e.g. a contract value change) and two requests process it at once.
  await Project.collection.updateOne({ _id: project._id }, { $set: { executedPercentage: 50 } });

  const run = async () => {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(() => recognizeProjectSalesOrderCosts(project._id, session));
      return 'ok';
    } catch (err) {
      return `failed: ${err.message}`;
    } finally {
      session.endSession();
    }
  };
  const outcomes = await Promise.all([run(), run(), run()]);
  assert.ok(outcomes.includes('ok'), outcomes.join(' | '));

  const entries = await costEntriesOf(order);
  assert.deepEqual(entries.map(e => e.totalDebit), [80000, 120000], 'exactly one +120,000 increment (50% x 400,000 = 200,000)');
  assert.equal((await recognitionOf(order)).totalRecognizedCost, 200000);
});

test('cancelling an order reverses its recognition and re-adjusts the others through reversals, never a negative entry', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  const orderA = await sell([PANEL(100)]); // 20%
  const orderB = await sell([PANEL(50)]); // 30%
  const orderC = await sell([PANEL(50)]); // 40%: A 160,000 / B 80,000 / C 80,000

  // Cancel B (the controller's flow: status + recalculation in one transaction) -> 300,000 / 1,000,000 = 30%.
  const session = await mongoose.startSession();
  await session.withTransaction(async () => {
    const fresh = await SalesOrder.findById(orderB._id).session(session);
    fresh.orderStatus = 'canceled';
    await fresh.save({ session });
    await recalculateExecutedPercentage(project._id, session, orderB._id);
  });
  session.endSession();

  const b = await recognitionOf(orderB);
  assert.deepEqual({ cost: b.costOfItems, total: b.totalRecognizedCost, current: b.currentRecognition }, { cost: 0, total: 0, current: -80000 });
  const bEntries = await costEntriesOf(orderB);
  assert.ok(bEntries.every(e => e.status === 'reversed'), 'all of B\'s recognition is reversed');

  const a = await recognitionOf(orderA);
  assert.equal(a.totalRecognizedCost, 120000, 'A back to 30% x 400,000');
  assert.equal(activeTotal(await costEntriesOf(orderA)), 120000);
  const c = await recognitionOf(orderC);
  assert.equal(c.totalRecognizedCost, 60000, 'C: its 80,000 entry reversed, then 60,000 posted');
  assert.equal(activeTotal(await costEntriesOf(orderC)), 60000);

  const reversals = await JournalEntry.find({ reversalOfEntry: { $ne: null } }).lean();
  assert.ok(reversals.length >= 3);
  for (const reversal of reversals) {
    assert.equal(reversal.totalDebit, reversal.totalCredit);
    reversal.lines.forEach(line => {
      assert.equal(line.description, reversal.description, 'reversal lines inherit the reversal description');
      assert.equal(line.projectNumber, project.projectNumber);
      assert.equal(line.partyNumber, customer.customerNumber);
    });
  }
  assert.equal(await JournalEntry.countDocuments({ 'lines.debit': { $lt: 0 } }), 0);
  assert.equal(await JournalEntry.countDocuments({ 'lines.credit': { $lt: 0 } }), 0);
});

test('a service-only order has no item cost: nothing is recognized and no entry is posted', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  const order = await sell([{ product: service._id, unitPrice: 5000, starterQuantity: 2 }]);
  const recognition = await recognitionOf(order);
  assert.equal(recognition.costOfItems, 0);
  assert.equal(recognition.totalRecognizedCost, 0);
  assert.deepEqual(recognition.journalEntries, []);
  assert.equal(await JournalEntry.countDocuments({ accountingAction: 'SO_COST_RECOGNITION' }), 0);
});

test('mixed product + service order: only the product carries cost', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  // 100 x 2,000 + 1 x 5,000 = 205,000 -> 20.5%; cost = 100 x 4,000 = 400,000 -> 82,000.
  const order = await sell([PANEL(100), { product: service._id, unitPrice: 5000, starterQuantity: 1 }]);
  const recognition = await recognitionOf(order);
  assert.equal(recognition.executedPercentage, 20.5);
  assert.equal(recognition.costOfItems, 400000);
  assert.equal(recognition.totalRecognizedCost, 82000);
});

test('existing orders: pre-feature orders are never recognized; first-version snapshots continue cumulatively', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  // An order created before Cost Recognition existed (no snapshot) on the same project.
  const legacyId = new mongoose.Types.ObjectId();
  await SalesOrder.collection.insertOne({
    _id: legacyId, customer: customer._id, project: project._id, orderSource: 'cashier', orderStatus: 'delivered',
    items: [{ product: product._id, unitPrice: 2000, starterQuantity: 10, returnedQuantity: 0, costWhenSold: 4000 }],
    totalAmount: 0, createdAt: new Date(),
  });
  // An order created by the first (one-time) version: recognized 80,000 once.
  const order = await sell([PANEL(100)]); // seeds a new-style snapshot at 20% = 80,000
  await SalesOrder.collection.updateOne(
    { _id: order._id },
    { $set: { costRecognition: { executedPercentage: 20, costOfItems: 400000, recognizedCost: 80000, journalEntry: (await costEntriesOf(order))[0]._id } } }
  );

  await sell([PANEL(50)]); // -> 30%
  const updated = await recognitionOf(order);
  assert.equal(updated.previouslyRecognizedCost, 80000, 'first-version recognizedCost is the starting point');
  assert.equal(updated.totalRecognizedCost, 120000);
  assert.equal((await SalesOrder.findById(legacyId).lean()).costRecognition, undefined, 'the pre-feature order is untouched');
  assert.equal(await JournalEntry.countDocuments({ triggeredBySalesOrder: legacyId, accountingAction: 'SO_COST_RECOGNITION' }), 0);
});

test('every automatic entry of an order stores the entry description on all of its lines', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  const order = await sell([PANEL(100)]);
  const entries = await JournalEntry.find({ $or: [{ triggeredBySalesOrder: order._id }] }).lean();
  const actions = entries.map(e => e.accountingAction).sort();
  assert.deepEqual(actions, ['PROJECT_REVENUE_RECOGNITION', 'SO_COST_RECOGNITION']);
  for (const entry of entries) {
    assert.ok(entry.description, 'the entry has a description');
    assert.ok(entry.lines.length >= 2);
    entry.lines.forEach(line => assert.equal(line.description, entry.description));
    assert.equal(entry.totalDebit, entry.totalCredit);
  }
});

test('manual entries: a line description typed by the user is kept, blank ones get the entry description', async () => {
  const entry = await JournalEntry.create({
    entryNumber: 9900001,
    description: 'Manual adjustment',
    source: 'manual',
    project: project._id,
    lines: [
      { account: accounts[C.costRawMaterials]._id, debit: 10, credit: 0, project: project._id, projectNumber: project.projectNumber, description: 'Typed by the accountant' },
      { account: accounts[AutomaticJournalAccountCodes.materialsInventory]._id, debit: 0, credit: 10, project: project._id, projectNumber: project.projectNumber },
    ],
  });
  assert.equal(entry.lines[0].description, 'Typed by the accountant');
  assert.equal(entry.lines[1].description, 'Manual adjustment');
});

// ---------------------------------------------------------------- JV0010 / JV0011 per "AUTOMATIC ENTERIES.xlsx"

test('JV0010: Dr Receivable + Dr Withholding / Cr VAT + Cr Revenue, balanced, with the sheet description, Project Number and customer Sub Account', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  // 100 x 2,000 = 200,000 executed (20%); VAT 10.5% = 21,000 (the sheet's VAT); withholding 1% = 2,000
  // (the sheet's 1,000 would be 0.5%, not an allowed withholding rate).
  const order = await sell([PANEL(100)], { vatPercentage: 10.5, withholdingTaxPercentage: 1 });
  const [entry] = await JournalEntry.find({ accountingAction: 'PROJECT_REVENUE_RECOGNITION', triggeredBySalesOrder: order._id }).lean();
  assert.ok(entry, 'one JV0010 entry');
  assert.deepEqual(
    entry.lines.map(l => [codeOf(l.account), l.debit, l.credit]),
    [
      [C.accountsReceivableProjects, 219000, 0],
      [C.withholdingTaxReceivable, 2000, 0],
      [C.vatPayable, 0, 21000],
      [C.revenue, 0, 200000],
    ]
  );
  assert.equal(entry.totalDebit, 221000);
  assert.equal(entry.totalCredit, 221000);
  assert.equal(entry.description, SalesOrderJournalDescriptions.revenue);
  assert.equal(entry.description, 'تنفيذ جزء من العقد للعميل');
  assert.equal(entry.reference, `SO ${order.code}`);
  assertEntryIntegrity(entry);

  // JV0011 is a separate entry of the same order.
  const [cost] = await costEntriesOf(order);
  assert.notEqual(String(cost._id), String(entry._id));
  assert.notEqual(cost.entryNumber, entry.entryNumber);
  assert.equal(cost.description, 'تحميل المشروع بالتكاليف بنسبة المنفذ من العقد');
  assert.deepEqual(
    cost.lines.map(l => [codeOf(l.account), l.debit, l.credit]),
    [
      [C.wipRawMaterials, 80000, 0],
      [C.costRawMaterials, 0, 80000],
    ]
  );
  assertEntryIntegrity(cost);
});

test('JV0011 per cost category: products on 11000009/50000001, services on their PUC account and its cost account', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  const design = await Product.create({ type: 'service', title: { en: 'Design', ar: 'تصميم' }, description: { en: 'd', ar: 'د' }, price: 50000, cost: 20000, durationValue: 1, durationUnit: 'month', pucAccount: accounts[C.wipEngineeringDesign]._id });
  const labour = await Product.create({ type: 'service', title: { en: 'Labour', ar: 'عمالة' }, description: { en: 'd', ar: 'د' }, price: 50000, cost: 10000, durationValue: 1, durationUnit: 'month', pucAccount: accounts[C.wipLabourWages]._id });
  // 100 x 2,000 + 50,000 + 50,000 = 300,000 -> 30%. Costs: 400,000 / 20,000 / 10,000.
  const order = await sell([PANEL(100), { product: design._id, unitPrice: 50000, starterQuantity: 1 }, { product: labour._id, unitPrice: 50000, starterQuantity: 1 }]);
  const [entry] = await costEntriesOf(order);
  assert.deepEqual(
    entry.lines.map(l => [codeOf(l.account), l.debit, l.credit]),
    [
      [C.wipRawMaterials, 120000, 0],
      [C.wipLabourWages, 3000, 0],
      [C.wipEngineeringDesign, 6000, 0],
      [C.costRawMaterials, 0, 120000],
      [C.costLabourWages, 0, 3000],
      [C.costEngineeringDesign, 0, 6000],
    ]
  );
  assertEntryIntegrity(entry);
  const recognition = await recognitionOf(order);
  assert.equal(recognition.totalRecognizedCost, 129000);
  assert.deepEqual(
    recognition.byAccount.map(r => [r.wipAccountCode, r.costAccountCode, r.costOfItems, r.recognizedCost]),
    [
      [C.wipRawMaterials, C.costRawMaterials, 400000, 120000],
      [C.wipLabourWages, C.costLabourWages, 10000, 3000],
      [C.wipEngineeringDesign, C.costEngineeringDesign, 20000, 6000],
    ]
  );

  // Next order -> 40%: only each category's difference is posted.
  await sell([PANEL(50)]);
  const entries = await costEntriesOf(order);
  assert.equal(entries.length, 2);
  assert.deepEqual(
    entries[1].lines.filter(l => l.debit > 0).map(l => [codeOf(l.account), l.debit]),
    [
      [C.wipRawMaterials, 40000],
      [C.wipLabourWages, 1000],
      [C.wipEngineeringDesign, 2000],
    ]
  );
});

test('a service with a cost whose PUC account is not one of the JV0011 accounts fails instead of using another account', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  const costly = await Product.create({ type: 'service', title: { en: 'Survey', ar: 'مساحة' }, description: { en: 'd', ar: 'د' }, price: 50000, cost: 1000, durationValue: 1, durationUnit: 'month', pucAccount: service.pucAccount });
  await assert.rejects(() => sell([{ product: costly._id, unitPrice: 50000, starterQuantity: 1 }]), /PUC account \(PUC-COST\) is not one of the cost recognition accounts/);
  assert.equal(await SalesOrder.countDocuments({}), 0, 'the order is not created');
  assert.equal(await JournalEntry.countDocuments({}), 0, 'nothing is posted');
});

test('entries posted by the earlier mapping (Dr 50000001 / Cr 11000007) are kept and counted, and reversed if execution drops', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  const order = await sell([PANEL(100)]); // 20% -> 80,000
  // Make it look like b880378 posted it: old accounts, a snapshot without byAccount.
  const [old] = await costEntriesOf(order);
  await JournalEntry.collection.updateOne(
    { _id: old._id },
    { $set: { 'lines.0.account': accounts[C.costRawMaterials]._id, 'lines.1.account': accounts[C.materialsInventory]._id } }
  );
  await SalesOrder.collection.updateOne({ _id: order._id }, { $unset: { 'costRecognition.byAccount': '' } });

  await sell([PANEL(50)]); // 30% -> +40,000 on the XLSX accounts only
  let entries = await costEntriesOf(order);
  assert.deepEqual(entries.map(e => e.totalDebit), [80000, 40000]);
  assert.equal(codeOf(entries[0].lines[0].account), C.costRawMaterials, 'the old entry is untouched');
  assert.deepEqual(entries[1].lines.map(l => codeOf(l.account)), [C.wipRawMaterials, C.costRawMaterials]);
  assert.equal((await recognitionOf(order)).totalRecognizedCost, 120000);

  // Execution drops to 10% (40,000): the new 40,000 entry and then the old 80,000 entry are reversed,
  // and 40,000 is posted again on the XLSX accounts.
  await Project.collection.updateOne({ _id: project._id }, { $set: { executedPercentage: 10 } });
  const session = await mongoose.startSession();
  await session.withTransaction(() => recognizeProjectSalesOrderCosts(project._id, session));
  session.endSession();
  entries = await costEntriesOf(order);
  assert.deepEqual(entries.map(e => [e.totalDebit, e.status]), [
    [80000, 'reversed'],
    [40000, 'reversed'],
    [40000, 'posted'],
  ]);
  const oldReversal = await JournalEntry.findOne({ reversalOfEntry: old._id }).lean();
  assert.deepEqual(oldReversal.lines.map(l => [codeOf(l.account), l.debit, l.credit]), [
    [C.costRawMaterials, 0, 80000],
    [C.materialsInventory, 80000, 0],
  ]);
  assert.equal((await recognitionOf(order)).totalRecognizedCost, 40000);
  assert.equal(activeTotal(entries), 40000);
});

// ---------------------------------------------------------------- documents

function mockResponse() {
  const res = { statusCode: null, body: null };
  res.status = code => {
    res.statusCode = code;
    return res;
  };
  res.json = body => {
    res.body = body;
    return res;
  };
  return res;
}

async function runHandler(handler, req) {
  const res = mockResponse();
  let error = null;
  await handler(req, res, err => {
    error = err;
  });
  return { res, error };
}

test('Scenario G: documents can be added to an existing Sales Order and Purchase Order, persist, and be removed', async () => {
  const salesOrder = await SalesOrder.create({ customer: customer._id, orderSource: 'cashier', project: project._id, employee: manager._id, items: [{ product: product._id, unitPrice: 10, starterQuantity: 1 }] });
  const vendor = await Vendor.create({ name: 'Doc Vendor', contact: { phone: `010${Date.now()}`.slice(0, 11) } });
  const purchaseOrder = await PurchaseOrder.create({ vendorId: vendor._id, warehouseId: warehouse._id, project: project._id, items: [{ productId: product._id, unitPrice: 10, starterQuantity: 1 }] });

  for (const [Model, order, label] of [
    [SalesOrder, salesOrder, 'Sales order'],
    [PurchaseOrder, purchaseOrder, 'Purchase order'],
  ]) {
    const { uploadOrderDocument, deleteOrderDocument } = createOrderDocumentHandlers(Model, label);
    const file = { path: 'https://files.example/contract.pdf', filename: `uploads/test/contract-${Date.now()}`, originalname: 'contract.pdf', mimetype: 'application/pdf' };

    const added = await runHandler(uploadOrderDocument, { params: { id: String(order._id) }, file, user: { _id: manager._id } });
    assert.equal(added.error, null);
    assert.equal(added.res.statusCode, 201);
    assert.equal(added.res.body.data.documents.length, 1);

    const reloaded = await Model.findById(order._id).lean(); // "refresh the page"
    assert.equal(reloaded.documents.length, 1);
    assert.equal(reloaded.documents[0].filename, 'contract.pdf');
    assert.equal(reloaded.documents[0].url, file.path);
    assert.equal(idStr(reloaded.documents[0].uploadedBy), idStr(manager._id));
    assert.equal(reloaded.grandTotal, (await Model.findById(order._id)).grandTotal, 'attaching a document does not touch the order');

    const removed = await runHandler(deleteOrderDocument, { params: { id: String(order._id), documentId: String(reloaded.documents[0]._id) } });
    assert.equal(removed.error, null);
    assert.equal(removed.res.body.data.documents.length, 0);
    assert.equal((await Model.findById(order._id).lean()).documents.length, 0);

    const missing = await runHandler(uploadOrderDocument, { params: { id: String(new mongoose.Types.ObjectId()) }, file, user: { _id: manager._id } });
    assert.equal(missing.error?.statusCode, 404);
    const noFile = await runHandler(uploadOrderDocument, { params: { id: String(order._id) }, user: { _id: manager._id } });
    assert.equal(noFile.error?.statusCode, 400);
  }
});

test('Scenario H: an older order with shipping cost, a payment method and no documents still loads', async () => {
  const _id = new mongoose.Types.ObjectId();
  await SalesOrder.collection.insertOne({
    _id,
    customer: customer._id,
    orderSource: 'cashier',
    paymentMethod: 'account',
    shippingCost: 150,
    shippingCostPaid: false,
    items: [],
    totalAmount: 1000,
    paidAmount: 0,
    createdAt: new Date(),
  });
  const legacy = await SalesOrder.findById(_id);
  assert.equal(legacy.shippingCost, 150, 'historical shipping cost preserved');
  assert.equal(legacy.paymentMethod, 'account');
  assert.deepEqual(legacy.toJSON().documents, []);
  assert.equal(legacy.costRecognition, null);
});
