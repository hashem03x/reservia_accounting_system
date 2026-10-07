const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Project Remaining Amount = Contract Value − Executed Amount, Executed Amount = Contract Value ×
// Executed % / 100 - one calculation (utils/projectExecution.js), applied on every Project save and
// in every Project API response, while Executed % keeps its Sales-Order-driven rule.

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_project_remaining_amount';

const { computeProjectExecution } = require('../../utils/projectExecution');
const { AutomaticJournalAccountCodes } = require('../../utils/accountingConstants');

let Project, SalesOrder, Product, ChartOfAccount, JournalEntry, User;
let recalculateExecutedPercentage, recalculateRemainingMoney;
let customer, service;

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  Project = require('../../models/project/projectModel');
  SalesOrder = require('../../models/sales/salesOrderModel');
  Product = require('../../models/inventory/productModel');
  ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
  JournalEntry = require('../../models/accounting/journalEntryModel');
  User = require('../../models/userModel');
  ({ recalculateExecutedPercentage, recalculateRemainingMoney } = require('../../services/project/projectAccountingService'));
  await Promise.all([Project.init(), SalesOrder.init(), ChartOfAccount.init(), JournalEntry.init()]);
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  await Promise.all([Project.deleteMany({}), SalesOrder.deleteMany({}), Product.deleteMany({}), ChartOfAccount.deleteMany({}), JournalEntry.deleteMany({}), User.deleteMany({})]);
  // Accounts the existing revenue recognition (posted when Executed % rises) looks up.
  await ChartOfAccount.create({ code: AutomaticJournalAccountCodes.accountsReceivableProjects, name: 'AR Projects', type: 'asset' });
  await ChartOfAccount.create({ code: AutomaticJournalAccountCodes.revenue, name: 'Revenue', type: 'revenue' });
  await ChartOfAccount.create({ code: AutomaticJournalAccountCodes.vatPayable, name: 'VAT Payable', type: 'liability' });
  await ChartOfAccount.create({ code: AutomaticJournalAccountCodes.withholdingTaxReceivable, name: 'WHT Receivable', type: 'asset' });
  const puc = await ChartOfAccount.create({ code: 'PUC-REMAINING', name: 'PUC', type: 'asset' });
  customer = await User.create({ name: 'Remaining Customer', email: `remaining-${Date.now()}@example.com`, role: 'user', type: 'online' });
  service = await Product.create({ type: 'service', title: { en: 'Install', ar: 'تركيب' }, description: { en: 'd', ar: 'د' }, price: 1000, durationValue: 1, durationUnit: 'month', pucAccount: puc._id });
});

const createProject = (contractValue, extra = {}) =>
  Project.create({ projectNumber: `PRJ-REM-${Date.now()}-${Math.random()}`, contractValue, remainingMoney: contractValue, startDate: new Date(), deliveryDate: new Date(Date.now() + 86400000), ...extra });
const createSalesOrder = (project, amount, extra = {}) =>
  SalesOrder.create({ customer: customer._id, orderSource: 'cashier', project: project._id, items: [{ product: service._id, unitPrice: amount, starterQuantity: 1 }], ...extra });
const json = doc => JSON.parse(JSON.stringify(doc));

test('the calculation: 0/20/50/75/100% of 1,000,000', () => {
  const cases = [
    [0, 0, 1000000],
    [20, 200000, 800000],
    [50, 500000, 500000],
    [75, 750000, 250000],
    [100, 1000000, 0],
  ];
  for (const [executedPercentage, executedAmount, remainingMoney] of cases) {
    assert.deepEqual(computeProjectExecution({ contractValue: 1000000, executedPercentage }), { executedAmount, remainingMoney }, `${executedPercentage}%`);
  }
});

test('the calculation: exact cents, clamped percentage, and no value without a contract', () => {
  // 333,333.33 × 33.33% = 111,099.9989 -> 111,100.00; executed + remaining add back to the contract exactly.
  assert.deepEqual(computeProjectExecution({ contractValue: 333333.33, executedPercentage: 33.33 }), { executedAmount: 111100, remainingMoney: 222233.33 });
  assert.deepEqual(computeProjectExecution({ contractValue: 0.3, executedPercentage: 10 }), { executedAmount: 0.03, remainingMoney: 0.27 });
  assert.deepEqual(computeProjectExecution({ contractValue: 1000, executedPercentage: 150 }), { executedAmount: 1000, remainingMoney: 0 });
  assert.deepEqual(computeProjectExecution({ contractValue: 1000, executedPercentage: -5 }), { executedAmount: 0, remainingMoney: 1000 });
  assert.deepEqual(computeProjectExecution({ contractValue: 1000, executedPercentage: undefined }), { executedAmount: 0, remainingMoney: 1000 });
  assert.equal(computeProjectExecution({ contractValue: null, executedPercentage: 20 }), null);
  assert.equal(computeProjectExecution({ contractValue: '1000', executedPercentage: 20 }), null, 'strings are never used for calculation');
});

test('Test 4 - a project with no Sales Orders: 0% executed, Remaining = Contract Value', async () => {
  const project = await createProject(1000000);
  await recalculateExecutedPercentage(project._id);
  const fresh = await Project.findById(project._id);
  assert.equal(fresh.executedPercentage, 0);
  assert.equal(fresh.remainingMoney, 1000000);
  assert.equal(json(fresh).executedAmount, 0);
});

test('Tests 1/5/6 - creating a 200,000 Sales Order on a 1,000,000 project: 20%, executed 200,000, remaining 800,000 - stored and returned', async () => {
  const project = await createProject(1000000);
  const order = await createSalesOrder(project, 200000);
  await recalculateExecutedPercentage(project._id, null, order._id); // what Sales Order creation calls

  const fresh = await Project.findById(project._id); // a "page refresh": read back from the DB
  assert.equal(fresh.executedPercentage, 20);
  assert.equal(fresh.remainingMoney, 800000, 'stored value');
  const body = json(fresh);
  assert.equal(body.executedAmount, 200000);
  assert.equal(body.remainingMoney, 800000);
  assert.equal(await JournalEntry.countDocuments({ accountingAction: 'PROJECT_REVENUE_RECOGNITION' }), 1, 'existing revenue recognition still posts');
});

test('Tests 2/3 - more Sales Orders move it to 50% then 100% (remaining 500,000 then 0); VAT does not change it', async () => {
  const project = await createProject(1000000);
  const first = await createSalesOrder(project, 500000, { vatPercentage: 14 });
  await recalculateExecutedPercentage(project._id, null, first._id);
  let fresh = await Project.findById(project._id);
  assert.equal(fresh.executedPercentage, 50, 'pre-tax amount drives Executed % (unchanged rule)');
  assert.equal(fresh.remainingMoney, 500000);
  assert.equal(json(fresh).executedAmount, 500000);

  const second = await createSalesOrder(project, 500000);
  await recalculateExecutedPercentage(project._id, null, second._id);
  fresh = await Project.findById(project._id);
  assert.equal(fresh.executedPercentage, 100);
  assert.equal(fresh.remainingMoney, 0);
  assert.equal(json(fresh).executedAmount, 1000000);
});

test('over-sold project stays capped at 100% / remaining 0 (existing clamp, no new rule)', async () => {
  const project = await createProject(1000000);
  const order = await createSalesOrder(project, 1200000);
  await recalculateExecutedPercentage(project._id, null, order._id);
  const fresh = await Project.findById(project._id);
  assert.equal(fresh.executedPercentage, 100);
  assert.equal(fresh.remainingMoney, 0);
});

test('cancelling a Sales Order lowers Executed % and raises Remaining automatically', async () => {
  const project = await createProject(1000000);
  const keep = await createSalesOrder(project, 200000);
  const cancel = await createSalesOrder(project, 300000);
  await recalculateExecutedPercentage(project._id, null, cancel._id);
  assert.equal((await Project.findById(project._id)).remainingMoney, 500000);

  await SalesOrder.updateOne({ _id: cancel._id }, { $set: { orderStatus: 'canceled' } });
  await recalculateExecutedPercentage(project._id, null, keep._id);
  const fresh = await Project.findById(project._id);
  assert.equal(fresh.executedPercentage, 20);
  assert.equal(fresh.remainingMoney, 800000);
});

test('changing the Contract Value re-derives Remaining with the same rule', async () => {
  const project = await createProject(1000000);
  const order = await createSalesOrder(project, 200000);
  await recalculateExecutedPercentage(project._id, null, order._id);

  const loaded = await Project.findById(project._id);
  loaded.contractValue = 400000; // what projectController.js#updateProject does, then recalculates
  await loaded.save();
  await recalculateRemainingMoney(project._id);
  await recalculateExecutedPercentage(project._id);
  const fresh = await Project.findById(project._id);
  assert.equal(fresh.executedPercentage, 50);
  assert.equal(fresh.remainingMoney, 200000);
});

test('a stale stored remainingMoney (saved under the old Payment rule) is never shown, and any save corrects it', async () => {
  const project = await createProject(1000000);
  await Project.collection.updateOne({ _id: project._id }, { $set: { executedPercentage: 20, remainingMoney: 1000000 } });

  const stale = await Project.findById(project._id);
  assert.equal(stale.remainingMoney, 1000000, 'stored value is stale');
  const body = json(stale);
  assert.equal(body.remainingMoney, 800000, 'the API response is still correct');
  assert.equal(body.executedAmount, 200000);

  await recalculateRemainingMoney(project._id);
  assert.equal((await Project.collection.findOne({ _id: project._id })).remainingMoney, 800000, 'stored value corrected');
});

test('Test 7 - list and details responses carry the same values', async () => {
  const project = await createProject(1000000);
  const order = await createSalesOrder(project, 200000);
  await recalculateExecutedPercentage(project._id, null, order._id);

  const [listed] = json(await Project.find({ _id: project._id }));
  const detail = json(await Project.findById(project._id));
  for (const key of ['contractValue', 'executedPercentage', 'executedAmount', 'remainingMoney']) {
    assert.equal(listed[key], detail[key], key);
  }
  assert.equal(listed.remainingMoney, 800000);
});

test('a project without a Contract Value keeps its stored value and gets no executed amount', async () => {
  const _id = new mongoose.Types.ObjectId();
  await Project.collection.insertOne({ _id, projectNumber: `PRJ-LEGACY-${Date.now()}`, remainingMoney: 4200, executedPercentage: 0, isDeleted: false });
  await recalculateRemainingMoney(_id);
  const fresh = await Project.findById(_id);
  assert.equal(fresh.remainingMoney, 4200);
  assert.equal(json(fresh).executedAmount, undefined);
});

test('remainingMoney sent by a client is ignored - it is always derived on save', async () => {
  const project = await createProject(1000000, { remainingMoney: 5 });
  assert.equal(project.remainingMoney, 1000000);
});
