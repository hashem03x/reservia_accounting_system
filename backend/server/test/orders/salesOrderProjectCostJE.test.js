const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Sales Order -> JV0010 (PROJECT_REVENUE_RECOGNITION) + JV0011 (PROJECT_COST_RECOGNITION, "AUTOMATIC
// ENTERIES.xlsx"): for every line of the project's Average Cost, Dr that cost account / Cr its
// corresponding PUC account (the PUC account named "<PUC> - <cost account name>" in the Chart of
// Accounts) for real cost x Executed %, run through the real createSalesOrder transaction.

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

// Chart of Accounts as imported: English `name`, Arabic `nameAr` (the sheet's own Arabic names,
// including its double space and en dash).
const CHART = {
  [C.accountsReceivableProjects]: ['Accounts Receivable (Projects)', 'عملاء مشروعات', 'asset'],
  [C.revenue]: ['Revenue', 'إيرادات', 'revenue'],
  [C.vatPayable]: ['VAT Payable', 'ضرائب قيمة مضافة مستحقة', 'liability'],
  [C.withholdingTaxReceivable]: ['Egyptian Tax Authority - Withholding & Addition', 'مصلحة الضرائب المصرية – ضرائب الخصم والإضافة', 'asset'],
  [C.materialsInventory]: ['Materials Inventory', 'مخزون مواد', 'asset'],
  [C.wipRawMaterials]: ['PUC - Raw Materials', 'مشروعات تحت التنفيذ -  مواد خام', 'asset'],
  [C.wipLabourWages]: ['PUC – Labour Wages', 'مشروعات تحت التنفيذ - أجور عمالة', 'asset'],
  [C.wipEngineeringDesign]: ['PUC - Engineering & Design', 'مشروعات تحت التنفيذ - هندسة وتصميم', 'asset'],
  50000001: ['Raw Materials', 'مواد خام', 'cogs'],
  50000002: ['Labour Wages', 'أجور عمالة', 'cogs'],
  50000004: ['Fuel & Logistics', 'وقود ونقل', 'cogs'],
  // A cost/PUC pair on codes nothing in the code knows about.
  'TEST-COST-EQ': ['Equipment', 'معدات', 'cogs'],
  'TEST-PUC-EQ': ['PUC - Equipment', 'مشروعات تحت التنفيذ - معدات', 'asset'],
};

beforeEach(async () => {
  await Promise.all([Warehouse, SalesOrder, Product, Project, User, ChartOfAccount, JournalEntry].map(M => M.deleteMany({})));
  accounts = {};
  for (const [code, [name, nameAr, type]] of Object.entries(CHART)) {
    accounts[code] = await ChartOfAccount.create({ code, name, nameAr, type });
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
    averageCostLines: [
      { account: accounts['50000001']._id, amount: 250000 },
      { account: accounts['50000002']._id, amount: 150000 },
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
const setAverageCost = lines => Project.updateOne({ _id: project._id }, { $set: { averageCostLines: lines.map(([code, amount]) => ({ account: accounts[code]._id, amount })) } });
const entriesOf = (order, accountingAction) => JournalEntry.find({ triggeredBySalesOrder: order._id, accountingAction }).sort({ entryNumber: 1 }).lean();

function assertProjectEntry(entry) {
  assert.equal(entry.totalDebit, entry.totalCredit, 'Debit total === Credit total');
  assert.equal(entry.module, 'Sales Order', 'source: SALES order');
  assert.equal(idStr(entry.project), idStr(project._id));
  assert.ok(entry.description, 'the entry has a description');
  for (const line of entry.lines) {
    assert.equal(line.projectNumber, 'PRJ001', 'Project Number on every line');
    assert.equal(line.description, entry.description, 'line description = entry description');
    assert.equal(line.partyNumber, customer.customerNumber, 'Sub Account = Customer Number on every line');
    assert.equal(line.partyType, 'customer');
    assert.ok(line.debit > 0 || line.credit > 0, 'no zero-value line');
    assert.ok(line.debit >= 0 && line.credit >= 0);
  }
}

test('exact example: Raw Materials 250,000 + Labour 150,000 at 20% -> JV0011 Dr Raw Materials 50,000 / Dr Labour 30,000 / Cr their PUC accounts; JV0010 unchanged', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  // 100 x 2,000 = 200,000 on a 1,000,000 contract -> 20%; VAT 10.5% = 21,000, withholding 1% = 2,000.
  const order = await sell(100, { vatPercentage: 10.5, withholdingTaxPercentage: 1 });
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
  assertProjectEntry(revenue);

  // JV0011 - each Average Cost account debited for real cost x 20%, its PUC account credited.
  const costEntries = await entriesOf(order, 'PROJECT_COST_RECOGNITION');
  assert.equal(costEntries.length, 1);
  const [cost] = costEntries;
  assert.deepEqual(linesOf(cost), [
    ['50000001', 50000, 0],
    ['50000002', 30000, 0],
    [C.wipRawMaterials, 0, 50000],
    [C.wipLabourWages, 0, 30000],
  ]);
  assert.equal(cost.totalDebit, 80000);
  assert.equal(cost.totalCredit, 80000);
  assert.equal(cost.description, 'تحميل المشروع بالتكاليف بنسبة المنفذ من العقد');
  assert.equal(cost.description, ProjectCostRecognitionDescription);
  cost.lines.forEach(line => assert.equal(line.description, cost.description));
  assert.equal(cost.source, 'automatic');
  assert.equal(cost.status, 'posted');
  assertProjectEntry(cost);

  // Every debit account is one of the project's Average Cost accounts.
  const averageCostAccounts = updated.averageCostLines.map(line => idStr(line.account));
  cost.lines.filter(l => l.debit > 0).forEach(l => assert.ok(averageCostAccounts.includes(idStr(l.account))));

  // Two separate entries of the same Sales Order event: own numbers (from the counter), same date.
  assert.equal(cost.entryNumber, revenue.entryNumber + 1);
  assert.equal(cost.date.getTime(), revenue.date.getTime());
});

test('a project with no linked customer: JV0010 and JV0011 lines carry the Sales Order customer number', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  await Project.updateOne({ _id: project._id }, { $unset: { customer: '' } });
  const order = await sell(100);
  for (const action of ['PROJECT_REVENUE_RECOGNITION', 'PROJECT_COST_RECOGNITION']) {
    const [entry] = await entriesOf(order, action);
    assertProjectEntry(entry);
  }
});

test('manual journal entries are unchanged: typed line descriptions are kept and no Sub Account is added', async () => {
  const entry = await JournalEntry.create({
    entryNumber: 9900001,
    description: 'Manual adjustment',
    source: 'manual',
    project: project._id,
    lines: [
      { account: accounts['50000001']._id, debit: 10, credit: 0, project: project._id, projectNumber: 'PRJ001', description: 'Typed by the accountant' },
      { account: accounts[C.wipRawMaterials]._id, debit: 0, credit: 10, project: project._id, projectNumber: 'PRJ001' },
    ],
  });
  assert.equal(entry.lines[0].description, 'Typed by the accountant');
  assert.equal(entry.lines[1].description, undefined);
  entry.lines.forEach(line => assert.equal(line.partyNumber, null));
});

test('raw materials only: one Dr Raw Materials / Cr PUC - Raw Materials pair, no labour lines', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  await setAverageCost([['50000001', 250000]]);
  const [cost] = await entriesOf(await sell(100), 'PROJECT_COST_RECOGNITION');
  assert.deepEqual(linesOf(cost), [
    ['50000001', 50000, 0],
    [C.wipRawMaterials, 0, 50000],
  ]);
});

test('labour only: one Dr Labour / Cr PUC - Labour pair, no raw-material lines', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  await setAverageCost([['50000002', 150000]]);
  const [cost] = await entriesOf(await sell(100), 'PROJECT_COST_RECOGNITION');
  assert.deepEqual(linesOf(cost), [
    ['50000002', 30000, 0],
    [C.wipLabourWages, 0, 30000],
  ]);
});

test('every Average Cost account takes part, matched to its PUC account by the Chart of Accounts - not by code', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  await setAverageCost([['50000001', 250000], ['50000002', 150000], ['TEST-COST-EQ', 50000]]);
  const [cost] = await entriesOf(await sell(100), 'PROJECT_COST_RECOGNITION');
  assert.deepEqual(linesOf(cost), [
    ['50000001', 50000, 0],
    ['50000002', 30000, 0],
    ['TEST-COST-EQ', 10000, 0],
    [C.wipRawMaterials, 0, 50000],
    [C.wipLabourWages, 0, 30000],
    ['TEST-PUC-EQ', 0, 10000],
  ]);
  assert.equal(cost.totalDebit, 90000);
  assert.equal(cost.totalCredit, 90000);
});

test('each later Sales Order posts only the increase, so the total stays real cost x Executed %', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  await sell(100); // 20%
  const second = await sell(50); // 30%: Raw Materials 75,000 total (+25,000), Labour 45,000 total (+15,000)
  const [increment] = await entriesOf(second, 'PROJECT_COST_RECOGNITION');
  assert.deepEqual(linesOf(increment), [
    ['50000001', 25000, 0],
    ['50000002', 15000, 0],
    [C.wipRawMaterials, 0, 25000],
    [C.wipLabourWages, 0, 15000],
  ]);
  const [totals] = await JournalEntry.aggregate([{ $match: { accountingAction: 'PROJECT_COST_RECOGNITION' } }, { $group: { _id: null, total: { $sum: '$totalDebit' } } }]);
  assert.equal(totals.total, 120000, '(250,000 + 150,000) x 30%');
});

test('no costs: no Average Cost (or only zero / unmatched lines) -> no JV0011 and no zero lines; the order and JV0010 are still created', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  await setAverageCost([]);
  const first = await sell(100);
  assert.equal((await entriesOf(first, 'PROJECT_REVENUE_RECOGNITION')).length, 1);
  assert.equal((await entriesOf(first, 'PROJECT_COST_RECOGNITION')).length, 0);
  assert.equal((await Project.findById(project._id).lean()).costRecognizedPercentage, 0, 'nothing recognized yet');

  // Fuel & Logistics has no PUC account in the Chart of Accounts: left out, never guessed.
  await setAverageCost([['50000004', 100000]]);
  const second = await sell(50);
  assert.equal((await entriesOf(second, 'PROJECT_COST_RECOGNITION')).length, 0);
  assert.equal(await JournalEntry.countDocuments({ lines: { $elemMatch: { debit: 0, credit: 0 } } }), 0);
});

test('a cost account without a PUC account is left out; the other lines are still posted', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  await setAverageCost([['50000001', 250000], ['50000004', 100000]]);
  const [cost] = await entriesOf(await sell(100), 'PROJECT_COST_RECOGNITION');
  assert.deepEqual(linesOf(cost), [
    ['50000001', 50000, 0],
    [C.wipRawMaterials, 0, 50000],
  ]);
});

test('a Sales Order without a project is rejected and no journal entry is created', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  await assert.rejects(() => sell(100, { project: undefined }), /A project is required to create a Sales Order/);
  assert.equal(await SalesOrder.countDocuments({}), 0);
  assert.equal(await JournalEntry.countDocuments({}), 0);
});

test('retrying the same accounting operation creates no duplicate JV0010 / JV0011', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  const order = await sell(100);
  const count = () => JournalEntry.countDocuments({ accountingAction: { $in: ['PROJECT_REVENUE_RECOGNITION', 'PROJECT_COST_RECOGNITION'] } });
  assert.equal(await count(), 2);

  await recalculateExecutedPercentage(project._id, null, order._id);
  // The posting itself again, as if the trackers had not been saved: the source key returns the
  // existing entries instead of creating new ones.
  const stale = await Project.findById(project._id);
  stale.revenueRecognizedPercentage = 0;
  stale.costRecognizedPercentage = 0;
  const again = await postProjectExecutionRecognitionJEs(stale, null, order._id);
  assert.equal(again.length, 2);
  assert.equal(await count(), 2, 'no duplicates');
  assert.deepEqual((await entriesOf(order, 'PROJECT_COST_RECOGNITION')).map(e => e.totalDebit), [80000]);
});

test('a failure while posting JV0011 rolls back the whole Sales Order - no order, no JV0010, no stock change', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  const originalCreate = JournalEntry.create;
  JournalEntry.create = function (docs, ...rest) {
    if (Array.isArray(docs) && docs[0]?.accountingAction === 'PROJECT_COST_RECOGNITION') throw new Error('forced JV0011 failure');
    return originalCreate.call(this, docs, ...rest);
  };
  try {
    await assert.rejects(() => sell(100, { vatPercentage: 14 }), /forced JV0011 failure/);
  } finally {
    JournalEntry.create = originalCreate;
  }
  assert.equal(await SalesOrder.countDocuments({}), 0, 'no Sales Order');
  assert.equal(await JournalEntry.countDocuments({}), 0, 'no JV0010 and no JV0011');
  const afterFailure = await Project.findById(project._id).lean();
  assert.equal(afterFailure.executedPercentage, 0);
  assert.equal(afterFailure.revenueRecognizedPercentage, 0);
  assert.equal(afterFailure.costRecognizedPercentage, 0);
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
          { account: accounts['50000001']._id, debit: 10, credit: 0 },
          { account: accounts[C.wipRawMaterials]._id, debit: 0, credit: 10 },
        ],
      }),
    /Project is required/
  );
  assert.equal(await JournalEntry.countDocuments({}), 0);
});
