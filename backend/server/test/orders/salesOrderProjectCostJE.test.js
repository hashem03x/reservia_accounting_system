const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Sales Order -> JV0010 (PROJECT_REVENUE_RECOGNITION) + JV0011 (PROJECT_COST_RECOGNITION, "AUTOMATIC
// ENTERIES.xlsx": Dr 11000009 WIP - Raw Materials / Cr 50000001 Raw Materials at the executed share
// of the project's Raw Materials Average Cost), run through the real createSalesOrder transaction.

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_so_project_cost_je';

const { AutomaticJournalAccountCodes: C, ProjectCostRecognitionDescription } = require('../../utils/accountingConstants');

let Warehouse, SalesOrder, Product, Project, User, ChartOfAccount, JournalEntry;
let createSalesOrder, recalculateExecutedPercentage, postProjectExecutionRecognitionJEs;
let transactionsSupported = true;
let warehouse, customer, manager, project, product, accounts;

const idStr = ref => String(ref?._id || ref);
const codeOf = accountId => Object.keys(accounts).find(code => idStr(accounts[code]) === idStr(accountId));
const linesOf = entry => entry.lines.map(l => [codeOf(l.account), l.debit, l.credit]);

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  // Warehouse before Payment (see orderTaxAndPayment.test.js for the circular-require note).
  Warehouse = require('../../models/inventory/warehouseModel');
  SalesOrder = require('../../models/sales/salesOrderModel');
  require('../../models/vendor/paymentModel');
  Product = require('../../models/inventory/productModel');
  Project = require('../../models/project/projectModel');
  User = require('../../models/userModel');
  ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
  JournalEntry = require('../../models/accounting/journalEntryModel');
  ({ createSalesOrder } = require('../../services/sales/salesOrderCreation.service'));
  ({ recalculateExecutedPercentage } = require('../../services/project/projectAccountingService'));
  ({ postProjectExecutionRecognitionJEs } = require('../../services/accounting/accountingEventService'));
  await Promise.all([SalesOrder.init(), Product.init(), Project.init(), ChartOfAccount.init(), JournalEntry.init()]);

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
  await Promise.all([Warehouse, SalesOrder, Product, Project, User, ChartOfAccount, JournalEntry].map(M => M.deleteMany({})));
  accounts = {};
  const codeToAccount = {
    [C.accountsReceivableProjects]: ['Accounts Receivable (Projects)', 'asset'],
    [C.revenue]: ['Revenue', 'revenue'],
    [C.vatPayable]: ['ضرائب قيمة مضافة مستحقة', 'liability'],
    [C.withholdingTaxReceivable]: ['مصلحة الضرائب المصرية – ضرائب الخصم والإضافة', 'asset'],
    [C.wipRawMaterials]: ['مشروعات تحت التنفيذ - مواد خام', 'asset'],
    [C.costRawMaterials]: ['مواد خام', 'cogs'],
    '50000002': ['أجور عمالة', 'cogs'],
  };
  for (const [code, [name, type]] of Object.entries(codeToAccount)) {
    accounts[code] = await ChartOfAccount.create({ code, name, type });
  }
  warehouse = await Warehouse.create({ name: 'JV0011 Warehouse', location: 'Cairo' });
  manager = await User.create({ name: 'JV0011 Manager', email: `jv11-mgr-${Date.now()}@example.com`, role: 'admin', type: 'online' });
  customer = await User.create({ name: 'JV0011 Customer', email: `jv11-cust-${Date.now()}@example.com`, role: 'user', type: 'online' });
  project = await Project.create({
    projectNumber: 'PRJ001',
    contractValue: 1000000,
    customer: customer._id,
    startDate: new Date(),
    deliveryDate: new Date(Date.now() + 86400000),
    // The project's cost structure: 250,000 of raw materials (and labour, which JV0011 does not load).
    averageCostLines: [
      { account: accounts[C.costRawMaterials]._id, amount: 250000 },
      { account: accounts['50000002']._id, amount: 100000 },
    ],
  });
  product = await Product.create({
    type: 'product',
    title: { en: 'Panel', ar: 'لوح' },
    description: { en: 'd', ar: 'د' },
    price: 2000,
    cost: 1500,
    category: new mongoose.Types.ObjectId(),
    subcategory: new mongoose.Types.ObjectId(),
    stock: [{ warehouse: warehouse._id, quantity: 1000 }],
  });
});

const sell = (quantity, extra = {}) =>
  createSalesOrder({
    customer: customer._id,
    warehouse: warehouse._id.toString(),
    project: project._id,
    items: [{ product: product._id, unitPrice: 2000, starterQuantity: quantity }],
    createdBy: manager._id,
    employee: manager._id,
    ...extra,
  });
const entriesOf = (order, accountingAction) => JournalEntry.find({ triggeredBySalesOrder: order._id, accountingAction }).sort({ entryNumber: 1 }).lean();

function assertProjectEntry(entry) {
  assert.equal(entry.totalDebit, entry.totalCredit, 'Debit total === Credit total');
  assert.equal(entry.module, 'Sales Order', 'source: SALES order');
  assert.equal(idStr(entry.project), idStr(project._id));
  for (const line of entry.lines) {
    assert.equal(line.projectNumber, 'PRJ001', 'Project Number on every line');
    assert.ok(line.debit >= 0 && line.credit >= 0);
  }
}

test('Case 1 / exact scenario: a 200,000 Sales Order on PRJ001 (1,000,000 contract -> 20%) posts JV0010 unchanged and JV0011 = Dr 11000009 50,000 / Cr 50000001 50,000', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  // 100 x 2,000 = 200,000 before VAT; VAT 10.5% = 21,000. Withholding 1% = 2,000 (1,000 would be
  // 0.5%, which is not an allowed withholding rate).
  const order = await sell(100, { vatPercentage: 10.5, withholdingTaxPercentage: 1 });
  assert.equal(order.totalAmount, 200000);
  assert.equal(order.vatAmount, 21000);
  const updated = await Project.findById(project._id).lean();
  assert.equal(updated.executedPercentage, 20);
  assert.equal(updated.remainingMoney, 800000);

  // JV0010 - the existing revenue entry, exactly as before.
  const [revenue] = await entriesOf(order, 'PROJECT_REVENUE_RECOGNITION');
  assert.deepEqual(linesOf(revenue), [
    [C.accountsReceivableProjects, 219000, 0],
    [C.revenue, 0, 200000],
    [C.vatPayable, 0, 21000],
    [C.withholdingTaxReceivable, 2000, 0],
  ]);
  assert.equal(revenue.totalDebit, 221000);
  assertProjectEntry(revenue);

  // JV0011 - the project cost entry: 20% of the 250,000 Raw Materials Average Cost.
  const costEntries = await entriesOf(order, 'PROJECT_COST_RECOGNITION');
  assert.equal(costEntries.length, 1);
  const [cost] = costEntries;
  assert.deepEqual(linesOf(cost), [
    [C.wipRawMaterials, 50000, 0],
    [C.costRawMaterials, 0, 50000],
  ]);
  assert.equal(cost.totalDebit, 50000);
  assert.equal(cost.totalCredit, 50000);
  assert.equal(cost.description, 'تحميل المشروع بالتكاليف بنسبة المنفذ من العقد');
  assert.equal(cost.description, ProjectCostRecognitionDescription);
  cost.lines.forEach(line => assert.equal(line.description, cost.description));
  assert.equal(cost.source, 'automatic');
  assert.equal(cost.status, 'posted');
  assertProjectEntry(cost);

  // Two separate entries of the same Sales Order event: own numbers (from the counter), same date.
  assert.notEqual(cost.entryNumber, revenue.entryNumber);
  assert.equal(cost.entryNumber, revenue.entryNumber + 1);
  assert.equal(cost.date.getTime(), revenue.date.getTime());
  assert.equal((await Project.findById(project._id).lean()).costRecognizedPercentage, 20);
});

test('Case 3: the JV0011 amount comes from the project Average Cost x executed %, posting only the increase', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  await Project.updateOne({ _id: project._id }, { $set: { 'averageCostLines.0.amount': 400000 } });
  const first = await sell(100); // 20% of 400,000
  assert.deepEqual(linesOf((await entriesOf(first, 'PROJECT_COST_RECOGNITION'))[0]), [
    [C.wipRawMaterials, 80000, 0],
    [C.costRawMaterials, 0, 80000],
  ]);

  const second = await sell(50); // 200,000 + 100,000 = 30%: 400,000 x 30% - 80,000 already = 40,000
  const [increment] = await entriesOf(second, 'PROJECT_COST_RECOGNITION');
  assert.equal(increment.totalDebit, 40000);
  assert.equal(await JournalEntry.countDocuments({ accountingAction: 'PROJECT_COST_RECOGNITION' }), 2);
  const loaded = await JournalEntry.aggregate([{ $match: { accountingAction: 'PROJECT_COST_RECOGNITION' } }, { $group: { _id: null, total: { $sum: '$totalDebit' } } }]);
  assert.equal(loaded[0].total, 120000, 'cumulative 30% x 400,000');
});

test('a project with no Raw Materials Average Cost still creates the Sales Order and JV0010, with no JV0011', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  await Project.updateOne({ _id: project._id }, { $set: { averageCostLines: [{ account: accounts['50000002']._id, amount: 100000 }] } });
  const order = await sell(100);
  assert.equal((await entriesOf(order, 'PROJECT_REVENUE_RECOGNITION')).length, 1);
  assert.equal((await entriesOf(order, 'PROJECT_COST_RECOGNITION')).length, 0);
  assert.equal((await Project.findById(project._id).lean()).costRecognizedPercentage, 0, 'nothing loaded yet');
});

test('Case 2: a Sales Order without a project is rejected and no journal entry is created', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  await assert.rejects(() => sell(100, { project: undefined }), /A project is required to create a Sales Order/);
  assert.equal(await SalesOrder.countDocuments({}), 0);
  assert.equal(await JournalEntry.countDocuments({}), 0);
});

test('Case 4: retrying the same accounting operation creates no duplicate JV0010 / JV0011', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  const order = await sell(100);
  const count = () => JournalEntry.countDocuments({ accountingAction: { $in: ['PROJECT_REVENUE_RECOGNITION', 'PROJECT_COST_RECOGNITION'] } });
  assert.equal(await count(), 2);

  // The same recalculation again (nothing changed).
  await recalculateExecutedPercentage(project._id, null, order._id);
  // The posting itself again, as if the trackers had not been saved: the source key returns the
  // existing entries instead of creating new ones.
  const stale = await Project.findById(project._id);
  stale.revenueRecognizedPercentage = 0;
  stale.costRecognizedPercentage = 0;
  const again = await postProjectExecutionRecognitionJEs(stale, null, order._id);
  assert.equal(again.length, 2);
  assert.equal(await count(), 2, 'no duplicates');
  assert.deepEqual((await entriesOf(order, 'PROJECT_COST_RECOGNITION')).map(e => e.totalDebit), [50000]);
});

test('Case 5: a failure while posting JV0011 rolls back the whole Sales Order - no order, no JV0010, no stock change', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  await ChartOfAccount.deleteOne({ code: C.wipRawMaterials }); // JV0011's debit account is missing
  await assert.rejects(() => sell(100, { vatPercentage: 14 }), /required Chart of Accounts account "11000009" was not found/);

  assert.equal(await SalesOrder.countDocuments({}), 0, 'no Sales Order');
  assert.equal(await JournalEntry.countDocuments({}), 0, 'no JV0010 and no JV0011');
  const after = await Project.findById(project._id).lean();
  assert.equal(after.executedPercentage, 0);
  assert.equal(after.revenueRecognizedPercentage, 0);
  assert.equal(after.costRecognizedPercentage, 0);
  const stock = (await Product.findById(product._id).lean()).stock.find(s => idStr(s.warehouse) === idStr(warehouse._id));
  assert.equal(stock.quantity, 1000, 'stock untouched');
});

test('the journal entry details endpoint loads JV0010 and JV0011', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  const { getJournalEntry } = require('../../controller/accounting/journalEntryController');
  const order = await sell(100);
  for (const action of ['PROJECT_REVENUE_RECOGNITION', 'PROJECT_COST_RECOGNITION']) {
    const [entry] = await entriesOf(order, action);
    const res = { statusCode: null, body: null };
    res.status = code => Object.assign(res, { statusCode: code });
    res.json = body => Object.assign(res, { body });
    let error = null;
    await getJournalEntry({ params: { id: String(entry._id) } }, res, err => {
      error = err;
    });
    assert.equal(error, null, `${action}: ${error?.message}`);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.entryNumber, entry.entryNumber);
  }
});

test('the JV0011 posting refuses to run without a project', async () => {
  const { postAutomaticJournalEntry } = require('../../services/accounting/accountingEventService');
  await assert.rejects(
    () =>
      postAutomaticJournalEntry({
        accountingAction: 'PROJECT_COST_RECOGNITION',
        sourceType: 'PROJECT',
        sourceId: new mongoose.Types.ObjectId(),
        description: ProjectCostRecognitionDescription,
        project: null,
        lines: [
          { account: accounts[C.wipRawMaterials]._id, debit: 10, credit: 0 },
          { account: accounts[C.costRawMaterials]._id, debit: 0, credit: 10 },
        ],
      }),
    /Project is required/
  );
  assert.equal(await JournalEntry.countDocuments({}), 0);
});
