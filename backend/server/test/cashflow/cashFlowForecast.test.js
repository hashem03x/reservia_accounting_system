const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Projected Cash Flow Forecasting - Phase 1 (docs section "Projected Cash Flow Forecasting and PO
// Cash-Out Forecast"). Tests the forecast SERVICE directly (mirrors this codebase's established
// convention - generalLedger.test.js, requisitionInvoiceLinking.test.js) since it's a pure
// read-only aggregation with no transaction/session involvement of its own.

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_cash_flow_forecast';

let User, Vendor, Project, Warehouse, Product, ChartOfAccount, JournalEntry;
let Requisition, PurchaseOrder, SalesOrder, Payment;
let forecastService;
let getNextJournalEntryNumber;

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();

  Warehouse = require('../../models/inventory/warehouseModel');
  User = require('../../models/userModel');
  Vendor = require('../../models/vendor/vendor');
  Project = require('../../models/project/projectModel');
  Product = require('../../models/inventory/productModel');
  ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
  JournalEntry = require('../../models/accounting/journalEntryModel');
  Requisition = require('../../models/vendor/requisitionModel');
  PurchaseOrder = require('../../models/vendor/purchaseOrder');
  SalesOrder = require('../../models/sales/salesOrderModel');
  Payment = require('../../models/vendor/paymentModel');

  forecastService = require('../../services/cashflow/cashFlowForecastService');
  ({ getNextJournalEntryNumber } = require('../../services/accounting/journalEntryNumberService'));

  await Promise.all([
    User.init(),
    Vendor.init(),
    Project.init(),
    ChartOfAccount.init(),
    JournalEntry.init(),
    Requisition.init(),
    PurchaseOrder.init(),
    SalesOrder.init(),
  ]);
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

let seq = 0;
let manager, customer, vendor, warehouse, product, project;

beforeEach(async () => {
  await Promise.all(
    [
      'users',
      'vendors',
      'projects',
      'warehouses',
      'products',
      'chartofaccounts',
      'journalentries',
      'requisitions',
      'purchaseorders',
      'salesorders',
      'payments',
      'counters',
    ].map(c => mongoose.connection.collection(c).deleteMany({})),
  );
  seq += 1;
  manager = await User.create({ name: 'CF Manager', email: `cf-manager-${seq}@example.com`, role: 'admin', type: 'online' });
  customer = await User.create({
    name: 'CF Customer',
    email: `cf-customer-${seq}@example.com`,
    role: 'user',
    type: 'online',
    paymentTerms: 'Net 30',
  });
  vendor = await Vendor.create({ name: 'CF Vendor', contact: { phone: `010${Date.now()}${seq}`.slice(0, 11) }, paymentTerms: 'Net 15' });
  warehouse = await Warehouse.create({ name: `CF Warehouse ${seq}`, location: 'Cairo' });
  product = await Product.create({
    type: 'service',
    title: { en: 'CF Service', ar: 'خدمة' },
    description: { en: 'd', ar: 'د' },
    price: 100,
    durationValue: 1,
    durationUnit: 'month',
  });
  project = await Project.create({
    projectNumber: `CF-PRJ-${seq}`,
    contractValue: 100000,
    customer: customer._id,
    projectManager: manager._id,
    startDate: new Date('2026-01-01'),
    deliveryDate: new Date('2026-12-31'),
    status: 'active',
  });
});

async function openRequisition(amount, overrides = {}) {
  const req = await Requisition.create({
    vendorId: vendor._id,
    project: project._id,
    items: [{ description: 'x', quantity: 1, unitPrice: amount }],
    ...overrides,
  });
  req.status = 'open';
  await req.save();
  return req;
}

// ===================== Customer inflow forecast =====================

test('1. Customer receipt forecast: an open Sales Order with a dueDate appears as SCHEDULED, amount = remainingAmount, date = dueDate', async () => {
  const order = await SalesOrder.create({
    customer: customer._id,
    warehouse: warehouse._id,
    project: project._id,
    orderSource: 'cashier',
    employee: manager._id,
    items: [{ product: product._id, unitPrice: 20000, starterQuantity: 1 }],
  });

  const { scheduled, unscheduled } = await forecastService.getCustomerInflowObligations({ projectIds: [project._id] });
  const line = scheduled.find(i => i.sourceId.toString() === order._id.toString());
  assert.ok(line, 'the open Sales Order must appear as a scheduled inflow');
  assert.equal(line.amount, 20000);
  assert.ok(line.date, 'must carry the order\'s own dueDate');
  assert.equal(new Date(line.date).toISOString().slice(0, 10), order.dueDate.toISOString().slice(0, 10));

  // The uninvoiced remainder (100,000 contract - 20,000 invoiced) must show as unscheduled.
  const remainder = unscheduled.find(i => i.source === 'project' && i.sourceId.toString() === project._id.toString());
  assert.ok(remainder);
  assert.equal(remainder.amount, 80000);
  assert.equal(remainder.date, null);
  assert.equal(remainder.status, 'unscheduled');
});

test('2. A project with no contractValue is flagged "cannot_calculate", never silently zero', async () => {
  const bareProject = await Project.create({
    projectNumber: `CF-BARE-${seq}`,
    projectManager: manager._id,
    startDate: new Date('2026-01-01'),
    deliveryDate: new Date('2026-12-31'),
  });
  const { unscheduled } = await forecastService.getCustomerInflowObligations({ projectIds: [bareProject._id] });
  const flag = unscheduled.find(i => i.sourceId.toString() === bareProject._id.toString());
  assert.ok(flag);
  assert.equal(flag.status, 'cannot_calculate');
  assert.equal(flag.reason, 'missing_contract_value');
});

test('9. A Sales Order missing a dueDate (historical, pre-field) falls back to unscheduled, never a guessed date', async () => {
  const raw = await mongoose.connection.collection('salesorders').insertOne({
    customer: customer._id,
    project: project._id,
    orderSource: 'cashier',
    orderStatus: 'pending',
    items: [{ product: product._id, unitPrice: 5000, starterQuantity: 1, starterSubtotal: 5000, subtotal: 5000, returnedQuantity: 0, itemDiscount: { type: 'fixed', value: 0 } }],
    totalAmount: 5000,
    grandTotal: 5000,
    paidAmount: 0,
    remainingAmount: 5000,
    paymentStatus: 'unpaid',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const { scheduled, unscheduled } = await forecastService.getCustomerInflowObligations({ projectIds: [project._id] });
  assert.ok(!scheduled.some(i => i.sourceId.toString() === raw.insertedId.toString()));
  const line = unscheduled.find(i => i.sourceId?.toString() === raw.insertedId.toString());
  assert.ok(line, 'a dueDate-less order must land in unscheduled, not be dropped or guessed');
  assert.equal(line.reason, 'invoice_missing_due_date');
});

test('6. A cancelled Sales Order is excluded entirely from the forecast', async () => {
  const order = await SalesOrder.create({
    customer: customer._id,
    warehouse: warehouse._id,
    project: project._id,
    orderSource: 'cashier',
    employee: manager._id,
    items: [{ product: product._id, unitPrice: 15000, starterQuantity: 1 }],
  });
  order.orderStatus = 'canceled';
  await order.save();

  const { scheduled, unscheduled } = await forecastService.getCustomerInflowObligations({ projectIds: [project._id] });
  assert.ok(!scheduled.some(i => i.sourceId.toString() === order._id.toString()));
  assert.ok(!unscheduled.some(i => i.sourceId?.toString() === order._id.toString()));
  // The full contract value (100,000) must be the uninvoiced remainder, since the cancelled
  // order's amount never counted as "invoiced".
  const remainder = unscheduled.find(i => i.source === 'project');
  assert.equal(remainder.amount, 100000);
});

// ===================== Vendor outflow forecast (the spec's own worked example) =====================

test('3+4. PO outflow: the spec\'s own worked example (100,000 PO, 60,000 invoiced via two invoices, 20,000 paid) -> 80,000 outstanding, split 40k unscheduled + 40k scheduled-unpaid', async () => {
  // The PO's own payment-terms dating (tested separately below in 3b/3c/3d) only applies while
  // NOTHING has been invoiced against it yet - once any invoice exists, the remainder reverts to
  // plain unscheduled, since the invoice's own due date/schedule is what the forecast reflects
  // from then on (never double-counted against the PO's own terms).
  const requisition = await openRequisition(100000, {
    issueDate: new Date('2026-01-01'),
    paymentTerms: { mode: 'lump_sum', lumpSumDueDate: new Date('2026-01-16') },
  });

  const invoice1 = await PurchaseOrder.create({
    vendorId: vendor._id,
    warehouseId: warehouse._id,
    project: project._id,
    requisition: requisition._id,
    items: [{ productId: product._id, unitPrice: 25000, starterQuantity: 1 }],
  });
  const invoice2 = await PurchaseOrder.create({
    vendorId: vendor._id,
    warehouseId: warehouse._id,
    project: project._id,
    requisition: requisition._id,
    items: [{ productId: product._id, unitPrice: 35000, starterQuantity: 1 }],
  });

  // 20,000 paid against invoice1 - reduces ITS OWN remainingAmount (paidAmount bumps via the
  // Payment model's own pre('save') hook, the exact mechanism this forecast must read, not
  // reimplement).
  await Payment.create({
    warehouseId: warehouse._id,
    vendorId: vendor._id,
    purchaseOrderId: invoice1._id,
    type: 'out',
    amountPaid: 20000,
    paymentCategory: 'purchase',
    paymentMethod: 'cash',
  });

  const { requisitions, scheduled, unscheduled } = await forecastService.getVendorOutflowObligations({ projectIds: [project._id] });

  const reqLine = unscheduled.find(i => i.source === 'requisition' && i.sourceId.toString() === requisition._id.toString());
  assert.ok(reqLine, 'the uninvoiced PO commitment (40,000) must appear as unscheduled - it has already been partially invoiced');
  assert.equal(reqLine.amount, 40000);
  assert.ok(!scheduled.some(i => i.source === 'requisition' && i.sourceId.toString() === requisition._id.toString()));

  const inv1Line = scheduled.find(i => i.sourceId.toString() === invoice1._id.toString());
  const inv2Line = scheduled.find(i => i.sourceId.toString() === invoice2._id.toString());
  assert.ok(inv1Line && inv2Line, 'both open invoices must appear as scheduled outflows');
  assert.equal(inv1Line.amount, 5000, 'invoice1: 25,000 - 20,000 paid = 5,000 remaining');
  assert.equal(inv2Line.amount, 35000, 'invoice2: untouched, fully remaining');

  const totalOutstanding = round2(reqLine.amount + inv1Line.amount + inv2Line.amount);
  assert.equal(totalOutstanding, 80000, 'matches the spec\'s own worked example exactly');
  assert.equal(requisitions.length, 1);
});

test('3b. PO created without any Purchase Invoice yet, with its own lump-sum due date: the full amount is dated accordingly', async () => {
  const requisition = await openRequisition(60000, {
    issueDate: new Date('2026-02-01'),
    paymentTerms: { mode: 'lump_sum', lumpSumDueDate: new Date('2026-03-03') }, // 30 days
  });

  const { scheduled, unscheduled } = await forecastService.getVendorOutflowObligations({ projectIds: [project._id] });
  const line = scheduled.find(i => i.source === 'requisition' && i.sourceId.toString() === requisition._id.toString());
  assert.ok(line, 'a brand-new, uninvoiced PO must be dated, not left unscheduled');
  assert.equal(line.amount, 60000, 'the entire PO amount - no invoice exists yet to split it');
  assert.equal(new Date(line.date).toISOString().slice(0, 10), '2026-03-03');
  assert.ok(!unscheduled.some(i => i.sourceId?.toString() === requisition._id.toString()));
});

test('3c. PO created without any Purchase Invoice yet, with Immediate payment terms: dated to the issue date itself', async () => {
  const requisition = await openRequisition(12000, {
    issueDate: new Date('2026-04-01'),
    paymentTerms: { mode: 'immediate' },
  });

  const { scheduled } = await forecastService.getVendorOutflowObligations({ projectIds: [project._id] });
  const line = scheduled.find(i => i.source === 'requisition' && i.sourceId.toString() === requisition._id.toString());
  assert.ok(line, 'an Immediate-terms PO must be dated');
  assert.equal(line.amount, 12000);
  assert.equal(new Date(line.date).toISOString().slice(0, 10), '2026-04-01');
});

test('3d. PO created without any Purchase Invoice yet, with Installment payment terms: one dated row per installment, amounts split by percentage, never one lump date', async () => {
  const requisition = await openRequisition(10000, {
    issueDate: new Date('2026-05-01'),
    paymentTerms: {
      mode: 'installments',
      installments: [
        { description: 'First', basis: 'percentage', percentage: 40, tenorDays: 10 },
        { description: 'Second', basis: 'percentage', percentage: 60, tenorDays: 40 },
      ],
    },
  });

  const { scheduled, unscheduled } = await forecastService.getVendorOutflowObligations({ projectIds: [project._id] });
  const lines = scheduled.filter(i => i.source === 'requisition' && i.sourceId.toString() === requisition._id.toString());
  assert.equal(lines.length, 2, 'one scheduled row per installment, never one row for the whole PO');
  assert.deepEqual(lines.map(l => l.amount).sort((a, b) => a - b), [4000, 6000]);
  assert.equal(round2(lines.reduce((sum, l) => sum + l.amount, 0)), 10000, 'the installment rows must reconcile exactly to the PO amount - never duplicated or short');
  assert.ok(!unscheduled.some(i => i.sourceId?.toString() === requisition._id.toString()));

  const dates = lines.map(l => new Date(l.date).toISOString().slice(0, 10)).sort();
  assert.deepEqual(dates, ['2026-05-11', '2026-06-10']); // issueDate + 10 / + 40 days
});

test('3e. PO fully invoiced: the Requisition contributes nothing at all (no stale/zero unscheduled line, no double counting)', async () => {
  const requisition = await openRequisition(15000);
  const invoice = await PurchaseOrder.create({
    vendorId: vendor._id,
    warehouseId: warehouse._id,
    project: project._id,
    requisition: requisition._id,
    items: [{ productId: product._id, unitPrice: 15000, starterQuantity: 1 }],
  });

  const { scheduled, unscheduled } = await forecastService.getVendorOutflowObligations({ projectIds: [project._id] });
  assert.ok(!scheduled.some(i => i.source === 'requisition' && i.sourceId.toString() === requisition._id.toString()));
  assert.ok(!unscheduled.some(i => i.source === 'requisition' && i.sourceId.toString() === requisition._id.toString()));
  // The invoice itself still carries the full 15,000 until it's paid off.
  const invLine = scheduled.find(i => i.sourceId.toString() === invoice._id.toString());
  assert.ok(invLine);
  assert.equal(invLine.amount, 15000);
});

test('3f. PO created with no payment terms of its own: stays unscheduled with an identifiable reason, never an invented date', async () => {
  const requisition = await openRequisition(8000); // no paymentTerms override - defaults to null

  const { scheduled, unscheduled } = await forecastService.getVendorOutflowObligations({ projectIds: [project._id] });
  assert.ok(!scheduled.some(i => i.sourceId?.toString() === requisition._id.toString()), 'must never invent a date');
  const line = unscheduled.find(i => i.sourceId?.toString() === requisition._id.toString());
  assert.ok(line, 'must still appear, flagged as unscheduled');
  assert.equal(line.amount, 8000);
  assert.equal(line.date, null);
  assert.equal(line.reason, 'uninvoiced_po_commitment', 'must be identifiable for correction');
});

test('5. A Purchase Return (reversal) reduces both the invoice\'s remainingAmount and the linked Requisition\'s invoicedAmount - the forecast reflects the reduction with no residual/negative amount', async () => {
  const requisition = await openRequisition(50000);
  const invoice = await PurchaseOrder.create({
    vendorId: vendor._id,
    warehouseId: warehouse._id,
    project: project._id,
    requisition: requisition._id,
    items: [{ productId: product._id, unitPrice: 25000, starterQuantity: 2 }], // total 50,000, matching the Requisition's own amount
  });

  // Simulate a Purchase Return's net effect on the two figures the forecast actually reads - the
  // invoice's own grandTotal/remainingAmount, and the Requisition's invoicedAmount - applied
  // directly, the same "direct collection write to reach a specific data state" convention this
  // file already uses elsewhere (e.g. test 9's raw insertOne). The real reversal engine's own
  // accounting correctness (Dr/Cr lines, vendor balance, idempotency) is already exhaustively
  // covered by test/accounting/reversalEngine.test.js with its own dedicated Chart of Accounts
  // fixture; what THIS test is about is purely the forecast's reactive behavior to a reduced
  // invoiced amount, never double counting and never going negative.
  await mongoose.connection.collection('purchaseorders').updateOne({ _id: invoice._id }, { $inc: { grandTotal: -25000, remainingAmount: -25000 } });
  await mongoose.connection.collection('requisitions').updateOne({ _id: requisition._id }, { $inc: { invoicedAmount: -25000 } });

  const { scheduled, unscheduled } = await forecastService.getVendorOutflowObligations({ projectIds: [project._id] });
  // This Requisition has no payment terms of its own (openRequisition's default), so its reopened
  // remainder stays unscheduled - this test is about the amount reconciling correctly, not dating.
  const reqLine = unscheduled.find(i => i.source === 'requisition' && i.sourceId.toString() === requisition._id.toString());
  const invLine = scheduled.find(i => i.sourceId.toString() === invoice._id.toString());

  // Returned half (25,000) of the invoice's total -> invoice remaining drops to 25,000, and the
  // Requisition's invoicedAmount drops by the same delta, so its own uninvoiced remainder grows
  // back by 25,000 (from 0 to 25,000) - never negative, never double counted.
  assert.ok(invLine);
  assert.equal(invLine.amount, 25000);
  assert.ok(reqLine);
  assert.equal(reqLine.amount, 25000);
  assert.ok(reqLine.amount >= 0 && invLine.amount >= 0);
  assert.ok(!scheduled.some(i => i.source === 'requisition' && i.sourceId.toString() === requisition._id.toString()));
});

test('6b. A cancelled Requisition (Purchase Order) is excluded entirely from the forecast', async () => {
  const requisition = await Requisition.create({
    vendorId: vendor._id,
    project: project._id,
    items: [{ description: 'x', quantity: 1, unitPrice: 10000 }],
  });
  requisition.status = 'cancelled';
  await requisition.save();

  const { requisitions, unscheduled } = await forecastService.getVendorOutflowObligations({ projectIds: [project._id] });
  assert.equal(requisitions.length, 0);
  assert.ok(!unscheduled.some(i => i.sourceId?.toString() === requisition._id.toString()));
});

// ===================== Consolidation, totals, opening/closing balances =====================

test('7. Consolidated totals reconcile exactly to a single project\'s own forecast when filtered to that project', async () => {
  await openRequisition(30000);
  await SalesOrder.create({
    customer: customer._id,
    warehouse: warehouse._id,
    project: project._id,
    orderSource: 'cashier',
    employee: manager._id,
    items: [{ product: product._id, unitPrice: 10000, starterQuantity: 1 }],
  });

  const consolidated = await forecastService.getConsolidatedForecast({ project: project._id.toString() });
  const projectForecast = await forecastService.getProjectForecast(project._id.toString());

  assert.equal(consolidated.totals.expectedReceipts, projectForecast.totals.expectedReceipts);
  assert.equal(consolidated.totals.expectedPayments, projectForecast.totals.expectedPayments);
  assert.equal(consolidated.totals.unscheduledReceipts, projectForecast.totals.unscheduledReceipts);
  assert.equal(consolidated.totals.unscheduledPayments, projectForecast.totals.unscheduledPayments);
  assert.equal(projectForecast.project._id.toString(), project._id.toString());
});

test('8. Opening/closing balance chains correctly across consecutive daily buckets', async () => {
  // A known opening cash position: post one simple balanced journal entry debiting a cash account.
  const cashAccount = await ChartOfAccount.create({ code: `CF-CASH-${seq}`, name: 'Cash', type: 'asset', state: 'cash' });
  const equityAccount = await ChartOfAccount.create({ code: `CF-EQ-${seq}`, name: 'Equity', type: 'equity' });
  const entryNumber = await getNextJournalEntryNumber();
  await JournalEntry.create({
    entryNumber,
    date: new Date('2026-01-01'),
    description: 'Opening capital',
    status: 'posted',
    project: project._id,
    lines: [
      { account: cashAccount._id, debit: 100000, credit: 0, description: 'Opening capital', project: project._id, projectNumber: project.projectNumber },
      { account: equityAccount._id, debit: 0, credit: 100000, description: 'Opening capital', project: project._id, projectNumber: project.projectNumber },
    ],
    totalDebit: 100000,
    totalCredit: 100000,
  });

  const order = await SalesOrder.create({
    customer: customer._id,
    warehouse: warehouse._id,
    project: project._id,
    orderSource: 'cashier',
    employee: manager._id,
    items: [{ product: product._id, unitPrice: 10000, starterQuantity: 1 }],
  });
  // Snapshot the real dueDate's day for a deterministic, in-range window.
  const from = new Date('2026-01-01');
  const to = new Date(order.dueDate.getTime() + 2 * 24 * 60 * 60 * 1000);

  const forecast = await forecastService.getConsolidatedForecast({ from, to, project: project._id.toString(), granularity: 'day' });
  assert.equal(forecast.opening.total, 100000);
  assert.equal(forecast.timeline[0].opening, 100000, 'first bucket opens at the real opening cash balance');

  let running = 100000;
  for (const bucket of forecast.timeline) {
    assert.equal(bucket.opening, running, `bucket ${bucket.period}: opening must equal the previous bucket's closing`);
    assert.equal(bucket.closing, round2(bucket.opening + bucket.inflow - bucket.outflow));
    running = bucket.closing;
  }
  assert.equal(forecast.totals.closingBalance, running);

  const dueDateBucket = forecast.timeline.find(b => b.period === order.dueDate.toISOString().slice(0, 10));
  assert.ok(dueDateBucket, 'the order\'s own due date must have its own bucket');
  assert.equal(dueDateBucket.inflow, 10000);
});

// ===================== Accounting isolation =====================

test('11. Reading the forecast (consolidated and per-project) never posts a journal entry or changes any balance', async () => {
  await openRequisition(20000);
  await SalesOrder.create({
    customer: customer._id,
    warehouse: warehouse._id,
    project: project._id,
    orderSource: 'cashier',
    employee: manager._id,
    items: [{ product: product._id, unitPrice: 10000, starterQuantity: 1 }],
  });

  const beforeEntries = await JournalEntry.countDocuments({});
  const beforeVendorBalance = (await Vendor.findById(vendor._id)).balance;

  await forecastService.getConsolidatedForecast({ project: project._id.toString() });
  await forecastService.getProjectForecast(project._id.toString());

  assert.equal(await JournalEntry.countDocuments({}), beforeEntries, 'a forecast read must never post a journal entry');
  assert.equal((await Vendor.findById(vendor._id)).balance, beforeVendorBalance, 'a forecast read must never change a vendor balance');
});

// ===================== Dashboard integration =====================

test('10. The dashboard\'s new forecast field is additive and well-formed', async () => {
  const { getDashboardSummaryData } = require('../../services/dashboard/dashboardService');
  const summary = await getDashboardSummaryData();
  assert.ok(summary.forecast);
  assert.equal(typeof summary.forecast.expectedReceipts, 'number');
  assert.equal(typeof summary.forecast.expectedPayments, 'number');
  assert.equal(typeof summary.forecast.netProjected, 'number');
  assert.equal(typeof summary.forecast.closingBalance, 'number');
  assert.ok(Number.isFinite(summary.forecast.shortfallProjectsCount));
});
