const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Covers services/dashboard/dashboardService.js - the single read-only aggregation backing the
// Admin Home dashboard (docs section "Admin Home / Dashboard"). Mirrors generalLedger.test.js's
// model-direct-creation convention rather than hitting the HTTP route, consistent with this test
// suite's existing style.

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_dashboard';

let Project;
let SalesOrder;
let PurchaseOrder;
let ChartOfAccount;
let JournalEntry;
let User;
let Vendor;
let Warehouse;
let getNextJournalEntryNumber;
let getDashboardSummaryData;
let manager;
let customer;
let vendor;

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();

  Project = require('../../models/project/projectModel');
  SalesOrder = require('../../models/sales/salesOrderModel');
  PurchaseOrder = require('../../models/vendor/purchaseOrder');
  ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
  JournalEntry = require('../../models/accounting/journalEntryModel');
  User = require('../../models/userModel');
  Vendor = require('../../models/vendor/vendor');
  Warehouse = require('../../models/inventory/warehouseModel');
  require('../../models/inventory/productModel');
  ({ getNextJournalEntryNumber } = require('../../services/accounting/journalEntryNumberService'));
  ({ getDashboardSummaryData } = require('../../services/dashboard/dashboardService'));

  await Promise.all([Project.init(), SalesOrder.init(), PurchaseOrder.init(), ChartOfAccount.init(), JournalEntry.init(), Vendor.init()]);
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  await Promise.all([
    Project.deleteMany({}),
    SalesOrder.deleteMany({}),
    PurchaseOrder.deleteMany({}),
    ChartOfAccount.deleteMany({}),
    JournalEntry.deleteMany({}),
    User.deleteMany({}),
    Vendor.deleteMany({}),
    Warehouse.deleteMany({}),
    mongoose.connection.collection('counters').deleteMany({}),
  ]);

  manager = await User.create({ name: 'Dashboard PM', email: `dash-pm-${Date.now()}@example.com`, role: 'admin', type: 'online' });
  customer = await User.create({ name: 'Dashboard Customer', email: `dash-customer-${Date.now()}@example.com`, role: 'user', type: 'online' });
  vendor = await Vendor.create({ name: 'Dashboard Vendor', contact: { phone: `010${Date.now()}`.slice(0, 11) } });
});

function fakeSalesOrder(overrides = {}) {
  return {
    customer: customer._id,
    orderSource: 'cashier',
    items: [{ product: new mongoose.Types.ObjectId(), unitPrice: 100, starterQuantity: 1 }],
    ...overrides,
  };
}

test('projects.totalContractValue sums only ACTIVE projects, executedPercentage is sales/contractValue for that same set', async () => {
  const activeProject = await Project.create({
    projectNumber: `DASH-ACTIVE-${Date.now()}`,
    contractValue: 1000000,
    projectManager: manager._id,
    startDate: new Date(),
    deliveryDate: new Date(Date.now() + 86400000),
    status: 'active',
  });
  const completedProject = await Project.create({
    projectNumber: `DASH-DONE-${Date.now()}`,
    contractValue: 500000,
    projectManager: manager._id,
    startDate: new Date(),
    deliveryDate: new Date(Date.now() + 86400000),
    status: 'completed',
  });

  await SalesOrder.create(fakeSalesOrder({ project: activeProject._id, items: [{ product: new mongoose.Types.ObjectId(), unitPrice: 300000, starterQuantity: 1 }] }));
  // A completed project's own sales must never leak into the active-projects aggregate.
  await SalesOrder.create(fakeSalesOrder({ project: completedProject._id, items: [{ product: new mongoose.Types.ObjectId(), unitPrice: 999999, starterQuantity: 1 }] }));

  const summary = await getDashboardSummaryData();
  assert.equal(summary.projects.activeCount, 1);
  assert.equal(summary.projects.totalContractValue, 1000000);
  assert.equal(summary.projects.executedPercentage, 30);
});

test('projects.executedPercentage is 0 (never NaN/Infinity) when there are no active projects', async () => {
  const summary = await getDashboardSummaryData();
  assert.equal(summary.projects.activeCount, 0);
  assert.equal(summary.projects.totalContractValue, 0);
  assert.equal(summary.projects.executedPercentage, 0);
  assert.ok(Number.isFinite(summary.projects.executedPercentage));
});

test('sales.total uses each order\'s final Total Amount (incl. VAT) and excludes canceled orders', async () => {
  const project = await Project.create({
    projectNumber: `DASH-SO-${Date.now()}`,
    projectManager: manager._id,
    startDate: new Date(),
    deliveryDate: new Date(Date.now() + 86400000),
  });

  await SalesOrder.create(fakeSalesOrder({ project: project._id, vatPercentage: 14, items: [{ product: new mongoose.Types.ObjectId(), unitPrice: 200000, starterQuantity: 1 }] }));

  const canceledOrder = await SalesOrder.create(fakeSalesOrder({ project: project._id, items: [{ product: new mongoose.Types.ObjectId(), unitPrice: 999999, starterQuantity: 1 }] }));
  canceledOrder.orderStatus = 'canceled';
  await canceledOrder.save();

  const summary = await getDashboardSummaryData();
  // 200,000 subtotal + 28,000 VAT = 228,000 Total Amount; the canceled order's 999,999 is excluded.
  assert.equal(summary.sales.total, 228000);
  assert.equal(summary.sales.count, 1);
});

test('executedPercentage stays on the pre-tax subtotal (VAT is never revenue/execution)', async () => {
  const project = await Project.create({
    projectNumber: `DASH-EXEC-VAT-${Date.now()}`,
    contractValue: 1000000,
    projectManager: manager._id,
    startDate: new Date(),
    deliveryDate: new Date(Date.now() + 86400000),
    status: 'active',
  });
  await SalesOrder.create(fakeSalesOrder({ project: project._id, vatPercentage: 14, items: [{ product: new mongoose.Types.ObjectId(), unitPrice: 100000, starterQuantity: 1 }] }));

  const summary = await getDashboardSummaryData();
  assert.equal(summary.projects.executedPercentage, 10, '100,000 pre-tax / 1,000,000 - the 14,000 VAT must not count as execution');
  assert.equal(summary.sales.total, 114000, 'while the Sales KPI itself reports the order Total Amount');
});

test('purchases.total uses each Purchase Order\'s final Total Amount (incl. VAT, net of withholding)', async () => {
  const project = await Project.create({
    projectNumber: `DASH-PO-VAT-${Date.now()}`,
    projectManager: manager._id,
    startDate: new Date(),
    deliveryDate: new Date(Date.now() + 86400000),
  });
  const warehouse = await Warehouse.create({ name: 'Dashboard VAT Warehouse', location: 'Cairo' });

  // 100,000 + 14% VAT (14,000) - 1% WHT (1,000) = 113,000
  await PurchaseOrder.create({
    vendorId: vendor._id,
    warehouseId: warehouse._id,
    project: project._id,
    vatPercentage: 14,
    withholdingTaxPercentage: 1,
    items: [{ productId: new mongoose.Types.ObjectId(), unitPrice: 100000, starterQuantity: 1 }],
  });

  const summary = await getDashboardSummaryData();
  assert.equal(summary.purchases.total, 113000);
});

test('purchases.total sums every Purchase Order (no cancellation concept exists for POs today)', async () => {
  const project = await Project.create({
    projectNumber: `DASH-PO-${Date.now()}`,
    projectManager: manager._id,
    startDate: new Date(),
    deliveryDate: new Date(Date.now() + 86400000),
  });
  const warehouse = await Warehouse.create({ name: 'Dashboard Warehouse', location: 'Cairo' });

  await PurchaseOrder.create({ vendorId: vendor._id, warehouseId: warehouse._id, project: project._id, items: [{ productId: new mongoose.Types.ObjectId(), unitPrice: 50000, starterQuantity: 1 }] });
  await PurchaseOrder.create({ vendorId: vendor._id, warehouseId: warehouse._id, project: project._id, items: [{ productId: new mongoose.Types.ObjectId(), unitPrice: 25000, starterQuantity: 1 }] });

  const summary = await getDashboardSummaryData();
  assert.equal(summary.purchases.total, 75000);
  assert.equal(summary.purchases.count, 2);
});

test('cash.total only sums eligible Cash & Cash Equivalent accounts (same two signals as isPaymentAccountEligible)', async () => {
  const cashAccount = await ChartOfAccount.create({ code: `DASH-CASH-${Date.now()}`, name: 'Bank A', type: 'asset', state: 'cash' });
  const otherCashAccount = await ChartOfAccount.create({ code: `DASH-CASH2-${Date.now()}`, name: 'Bank B (Imported)', type: 'asset', parentGroupNameEn: 'Cash & Cash Equivalents' });
  const revenueAccount = await ChartOfAccount.create({ code: `DASH-REV-${Date.now()}`, name: 'Revenue', type: 'revenue' });

  const entryNumber1 = await getNextJournalEntryNumber();
  await JournalEntry.create({ entryNumber: entryNumber1, status: 'posted', source: 'automatic', lines: [{ account: cashAccount._id, description: 'Test line', debit: 10000, credit: 0 }, { account: revenueAccount._id, description: 'Test line', debit: 0, credit: 10000 }] });
  const entryNumber2 = await getNextJournalEntryNumber();
  await JournalEntry.create({ entryNumber: entryNumber2, status: 'posted', source: 'automatic', lines: [{ account: otherCashAccount._id, description: 'Test line', debit: 5000, credit: 0 }, { account: revenueAccount._id, description: 'Test line', debit: 0, credit: 5000 }] });

  const summary = await getDashboardSummaryData();
  assert.equal(summary.cash.accounts.length, 2, 'the revenue account must never be classified as Cash & Cash Equivalent');
  assert.equal(summary.cash.total, 15000);
  const bankA = summary.cash.accounts.find(a => a._id.toString() === cashAccount._id.toString());
  assert.equal(bankA.balance, 10000);
});

test('receivables/payables default to 0 (not NaN) when the well-known AR/Suppliers accounts do not exist yet', async () => {
  const summary = await getDashboardSummaryData();
  assert.equal(summary.receivables.total, 0);
  assert.equal(summary.payables.total, 0);
});

test('salesTrend always returns exactly 6 months, newest last, filling any month with no sales as 0', async () => {
  const project = await Project.create({
    projectNumber: `DASH-TREND-${Date.now()}`,
    projectManager: manager._id,
    startDate: new Date(),
    deliveryDate: new Date(Date.now() + 86400000),
  });
  await SalesOrder.create(fakeSalesOrder({ project: project._id, items: [{ product: new mongoose.Types.ObjectId(), unitPrice: 42000, starterQuantity: 1 }] }));

  const summary = await getDashboardSummaryData();
  assert.equal(summary.salesTrend.length, 6);

  const now = new Date();
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const currentMonthRow = summary.salesTrend[summary.salesTrend.length - 1];
  assert.equal(currentMonthRow.month, currentMonthKey, 'the last entry must be the current month');
  assert.equal(currentMonthRow.total, 42000);

  summary.salesTrend.forEach(row => {
    assert.ok(Number.isFinite(row.total), 'every month must have a finite total, never NaN/undefined');
  });
});
