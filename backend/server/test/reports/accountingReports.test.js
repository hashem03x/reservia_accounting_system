const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Accounting reports (services/reports/*) against one explicit ledger. Every expected figure below
// is worked out by hand from the entries in the fixture (see the comments), never copied from the
// code under test.

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_accounting_reports';

let JournalEntry, ChartOfAccount, Project, Sector, User, Vendor, SalesOrder, PurchaseOrder, FixedAsset, Product, DisclosureNote;
let R; // report functions by key
let runReport, buildWorkbook;
const A = {}; // accounts
const P = {}; // projects
let c1, c2, v1, so1, asset;
let entryNo = 500000;
const id = () => new mongoose.Types.ObjectId();

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  require('../../models/inventory/warehouseModel');
  require('../../models/vendor/paymentModel');
  JournalEntry = require('../../models/accounting/journalEntryModel');
  ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
  Project = require('../../models/project/projectModel');
  Sector = require('../../models/project/sectorModel');
  User = require('../../models/userModel');
  Vendor = require('../../models/vendor/vendor');
  SalesOrder = require('../../models/sales/salesOrderModel');
  PurchaseOrder = require('../../models/vendor/purchaseOrder');
  FixedAsset = require('../../models/fixedAssets');
  Product = require('../../models/inventory/productModel');
  DisclosureNote = require('../../models/reports/disclosureNoteModel');
  require('../../models/equity/shareholderModel');
  const { REPORTS_BY_KEY } = require('../../services/reports/reportRegistry');
  R = Object.fromEntries([...REPORTS_BY_KEY].map(([k, r]) => [k, r.run]));
  ({ runReport, buildWorkbook } = require('../../controller/reports/accountingReportsController'));

  const { AutomaticJournalAccountCodes: CODES } = require('../../utils/accountingConstants');
  const account = (key, code, name, type, parentGroupNameEn) => ChartOfAccount.create({ code, name, type, parentGroupNameEn }).then(a => (A[key] = a));
  await account('bank', '11000001', 'Bank Misr', 'asset', 'Cash & Cash Equivalents');
  await account('safe', '11000002', 'Main Safe', 'asset', 'Cash & Cash Equivalents');
  await account('ar', CODES.accountsReceivableProjects, 'Accounts Receivable (Projects)', 'asset', 'Receivables');
  await account('custAdv', CODES.customerAdvancesPayable, 'Advances from Customers', 'liability', 'Current Liabilities');
  await account('suppliers', CODES.suppliers, 'Suppliers', 'liability', 'Current Liabilities');
  await account('supAdv', CODES.advanceToSuppliers, 'Advances to Suppliers', 'asset', 'Receivables');
  await account('inputVat', CODES.inputVat, 'Input VAT', 'asset', 'Receivables');
  await account('vat', CODES.vatPayable, 'VAT Payable', 'liability', 'Current Liabilities');
  await account('truck', '12000001', 'Vehicles', 'asset', 'Property, Plant & Equipment');
  await account('accDep', '12000099', 'Accumulated Depreciation – Fixed Assets', 'asset', 'Property, Plant & Equipment');
  await account('depExp', '62000001', 'Depreciation & Amortization', 'expense', 'Operating Expenses');
  await account('rent', '61000001', 'Office Rent', 'expense', 'Operating Expenses');
  await account('capital', '20000001', 'Share Capital', 'equity', 'Equity');
  await account('revenue', CODES.revenue, 'Revenue', 'revenue', 'Revenue');
  await account('cogs', '50000001', 'Raw Materials', 'cogs', 'Cost of Sales');
  await account('wip', CODES.wipRawMaterials, 'PUC - Raw Materials', 'asset', 'Projects Under Construction');

  c1 = await User.create({ name: 'Delta Builders', email: `c1-${Date.now()}@example.com`, role: 'user', type: 'online' });
  c2 = await User.create({ name: 'Nile Homes', email: `c2-${Date.now()}@example.com`, role: 'user', type: 'online' });
  v1 = await Vendor.create({ name: 'Steel Co', contact: { phone: `010${Date.now()}`.slice(0, 11) } });
  await Sector.collection.insertMany([{ name: 'Villa', isActive: true }, { name: 'Industrials', isActive: false }]);
  const project = (key, number, customer, sector, status, contractValue, executedPercentage) => {
    P[key] = { _id: id(), projectNumber: number };
    return Project.collection.insertOne({ _id: P[key]._id, projectNumber: number, name: `Project ${number}`, customer: customer?._id || null, sector, status, contractValue, executedPercentage, startDate: new Date('2026-01-01'), deliveryDate: new Date('2026-12-31'), isDeleted: false });
  };
  await project('p1', 'PRJ001', c1, 'Villa', 'active', 1000000, 20);
  await project('p2', 'PRJ002', c2, 'Industrials', 'completed', 500000, 10);
  await project('p3', 'PRJ003', null, null, 'on_hold', null, 0);

  // Ledger. line(account, debit, credit, extra)
  const line = (acc, debit, credit, extra = {}) => ({ account: A[acc]._id, debit, credit, ...extra });
  const onP = key => ({ project: P[key]._id, projectNumber: P[key].projectNumber });
  const cust = c => ({ partyNumber: c.customerNumber, partyType: 'customer' });
  const vend = { partyNumber: v1.vendorNumber, partyType: 'vendor' };
  const je = async (date, lines, extra = {}) => {
    const doc = { _id: id(), entryNumber: (entryNo += 1), date: new Date(date), description: extra.description || `Entry ${entryNo}`, status: 'posted', source: 'automatic', lines, totalDebit: lines.reduce((s, l) => s + l.debit, 0), totalCredit: lines.reduce((s, l) => s + l.credit, 0), ...extra };
    await JournalEntry.collection.insertOne(doc);
    return doc;
  };
  so1 = id();
  // E1 2025-12-01 (before the period): capital 1,000,000 into the bank.
  await je('2025-12-01T10:00:00Z', [line('bank', 1000000, 0), line('capital', 0, 1000000)], { accountingAction: 'SHAREHOLDER_CONTRIBUTION' });
  // E2 truck bought on credit: Dr truck 120,000 + VAT 16,800 / Cr suppliers 136,800.
  const e2 = await je('2026-01-10T10:00:00Z', [line('truck', 120000, 0, vend), line('inputVat', 16800, 0, vend), line('suppliers', 0, 136800, vend)], { accountingAction: 'FIXED_ASSET_ACQUISITION' });
  // E3 / E4 Sales Order SO1 on PRJ001: revenue 200,000 + VAT 28,000; cost 50,000.
  await je('2026-02-01T10:00:00Z', [line('ar', 228000, 0, { ...onP('p1'), ...cust(c1) }), line('revenue', 0, 200000, { ...onP('p1'), ...cust(c1) }), line('vat', 0, 28000, { ...onP('p1'), ...cust(c1) })], { accountingAction: 'PROJECT_REVENUE_RECOGNITION', triggeredBySalesOrder: so1, project: P.p1._id });
  await je('2026-02-01T10:00:01Z', [line('cogs', 50000, 0, onP('p1')), line('wip', 0, 50000, onP('p1'))], { accountingAction: 'PROJECT_COST_RECOGNITION', triggeredBySalesOrder: so1, project: P.p1._id });
  // E5 customer pays 100,000 for PRJ001.
  await je('2026-03-01T10:00:00Z', [line('bank', 100000, 0, onP('p1')), line('ar', 0, 100000, { ...onP('p1'), ...cust(c1) })], { accountingAction: 'SO_PAYMENT_RECORDED' });
  // E6 supplier paid 36,800; E7 rent 10,000 on credit; E8 rent paid.
  await je('2026-03-15T10:00:00Z', [line('suppliers', 36800, 0, vend), line('bank', 0, 36800)], { accountingAction: 'PO_PAYMENT_RECORDED' });
  await je('2026-04-01T10:00:00Z', [line('rent', 10000, 0, vend), line('suppliers', 0, 10000, vend)], { accountingAction: 'EXPENSE_RECORDED', description: 'Office rent April' });
  await je('2026-04-02T10:00:00Z', [line('suppliers', 10000, 0, vend), line('bank', 0, 10000, vend)], { accountingAction: 'EXPENSE_PAYMENT_RECORDED' });
  // E9 internal transfer bank -> safe 5,000.
  await je('2026-05-01T10:00:00Z', [line('safe', 5000, 0), line('bank', 0, 5000)]);
  // E10 depreciation 2,000 for May.
  const e10 = await je('2026-05-31T12:00:00Z', [line('depExp', 2000, 0), line('accDep', 0, 2000)], { accountingAction: 'FIXED_ASSET_DEPRECIATION' });
  // E11 revenue 50,000 on PRJ002, reversed on 2026-06-10 (E12): together they net to zero.
  const e11 = await je('2026-06-01T10:00:00Z', [line('ar', 50000, 0, { ...onP('p2'), ...cust(c2) }), line('revenue', 0, 50000, { ...onP('p2'), ...cust(c2) })], { accountingAction: 'PROJECT_REVENUE_RECOGNITION', project: P.p2._id, status: 'reversed' });
  await je('2026-06-10T10:00:00Z', [line('revenue', 50000, 0, { ...onP('p2'), ...cust(c2) }), line('ar', 0, 50000, { ...onP('p2'), ...cust(c2) })], { reversalOfEntry: e11._id, project: P.p2._id });
  // E13 a draft (never counts); E14 after the period; E15 cash sale without a project.
  await je('2026-06-15T10:00:00Z', [line('rent', 999, 0), line('bank', 0, 999)], { status: 'draft' });
  await je('2026-07-05T10:00:00Z', [line('bank', 1, 0), line('revenue', 0, 1)]);
  await je('2026-06-20T10:00:00Z', [line('bank', 3000, 0), line('revenue', 0, 3000)]);

  // Documents behind the order / asset reports.
  await SalesOrder.collection.insertOne({ _id: so1, code: 'SO-0001', customer: c1._id, project: P.p1._id, orderSource: 'cashier', orderStatus: 'pending', paymentStatus: 'partial', createdAt: new Date('2026-02-01T09:00:00Z'), totalAmount: 200000, vatAmount: 28000, withholdingTaxAmount: 0, grandTotal: 228000, paidAmount: 100000, items: [{ product: id(), unitPrice: 2000, starterQuantity: 100, returnedQuantity: 0, costWhenSold: 400 }] });
  const service = id();
  await Product.collection.insertOne({ _id: service, type: 'service', title: { en: 'Design', ar: 'تصميم' } });
  await PurchaseOrder.collection.insertOne({ _id: id(), code: 'PO-0001', vendorId: v1._id, project: P.p1._id, createdAt: new Date('2026-03-01T09:00:00Z'), totalAmount: 1000, vatAmount: 140, withholdingTaxAmount: 10, grandTotal: 1130, paidAmount: 130, paymentStatus: 'partial', items: [{ productId: service, unitPrice: 1000, starterQuantity: 1 }] });
  asset = { _id: id() };
  await FixedAsset.collection.insertOne({
    _id: asset._id,
    name: 'Delivery Truck',
    vendor: v1._id,
    price: 120000,
    bookValue: 118000,
    accumulatedDepreciation: 2000,
    usefulLifeMonths: 60,
    assetClass: 'tangible',
    assetAccountId: A.truck._id,
    accumulatedAccountId: A.accDep._id,
    depreciationAccountId: A.depExp._id,
    acquisitionDate: new Date('2026-01-10'),
    acquisitionJournalEntry: e2._id,
    depreciations: [{ period: '2026-05', amount: 2000, date: e10.date, journalEntry: e10._id }],
    status: 'active',
  });
  asset.e10 = e10;
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

const PERIOD = { from: '2026-01-01', to: '2026-06-30' };
const rowOf = (section, code) => section.rows.find(r => r.code === code);
const allChecksOk = report => report.checks.forEach(c => assert.ok(c.ok, `${c.label.en}: ${c.detail}`));

test('Trial Balance: opening before the period, period movements, closing, reversal nets to zero, drafts and later entries excluded', async () => {
  const report = await R['trial-balance'](PERIOD);
  const s = report.sections[0];
  const bank = rowOf(s, '11000001');
  // opening 1,000,000; in 100,000 + 3,000; out 36,800 + 10,000 + 5,000 (draft 999 and July 1 excluded)
  assert.deepEqual([bank.openingDebit, bank.periodDebit, bank.periodCredit, bank.closingDebit, bank.side], [1000000, 103000, 51800, 1051200, 'Dr']);
  const capital = rowOf(s, '20000001');
  assert.deepEqual([capital.openingCredit, capital.periodCredit, capital.closingCredit], [1000000, 0, 1000000]);
  const revenue = rowOf(s, A.revenue.code);
  // 200,000 + 50,000 + 3,000 credits, 50,000 reversal debit -> closing credit 203,000
  assert.deepEqual([revenue.periodCredit, revenue.periodDebit, revenue.closingCredit], [253000, 50000, 203000]);
  assert.equal(rowOf(s, A.ar.code).closingDebit, 128000);
  assert.equal(rowOf(s, A.suppliers.code).closingCredit, 100000);
  assert.equal(s.totals.periodDebit, 681600);
  assert.equal(s.totals.periodCredit, 681600);
  assert.equal(s.totals.openingDebit, s.totals.openingCredit);
  assert.equal(s.totals.closingDebit, s.totals.closingCredit);
  allChecksOk(report);
  assert.equal(s.rows.some(r => r.code === A.custAdv.code), false, 'zero-activity accounts are left out by default');
  const withZero = await R['trial-balance']({ ...PERIOD, includeZero: 'true' });
  assert.ok(withZero.sections[0].rows.some(r => r.code === A.custAdv.code && r.netBalance === 0));
});

test('Statement of Profit or Loss: revenue, cost of sales, gross profit and margin, net profit', async () => {
  const report = await R['profit-loss'](PERIOD);
  const value = key => report.summary.find(s => s.key === key).value;
  assert.equal(value('revenue'), 203000);
  assert.equal(value('cogs'), 50000);
  assert.equal(value('grossProfit'), 153000);
  assert.equal(value('grossMargin'), 75.37); // 153,000 / 203,000
  assert.equal(value('expenses'), 12000); // rent 10,000 + depreciation 2,000
  assert.equal(value('netProfit'), 141000);
});

test('Statement of Financial Position: assets = liabilities + equity, unclosed profit shown once', async () => {
  const report = await R['financial-position']({ asOf: '2026-06-30' });
  const value = key => report.summary.find(s => s.key === key).value;
  // bank 1,051,200 + safe 5,000 + truck 120,000 - acc.dep 2,000 + input VAT 16,800 + AR 128,000 - WIP 50,000
  assert.equal(value('totalAssets'), 1269000);
  assert.equal(value('totalLiabilities'), 128000); // suppliers 100,000 + VAT 28,000
  assert.equal(value('totalEquity'), 1141000); // capital 1,000,000 + profit 141,000
  allChecksOk(report);
  const equityRows = report.sections.find(s => s.key === 'equity').rows;
  assert.equal(equityRows.filter(r => /not yet closed/.test(r.name || '')).length, 1);
  assert.equal(equityRows.find(r => /not yet closed/.test(r.name || '')).amount, 141000);
  // History: as of 2025-12-31 only the capital exists.
  const early = await R['financial-position']({ asOf: '2025-12-31' });
  assert.equal(early.summary.find(s => s.key === 'totalAssets').value, 1000000);
});

test('Statement of Cash Flows: direct method, transfer and non-cash entries excluded, reconciles to cash balances', async () => {
  const report = await R['cash-flow'](PERIOD);
  const value = key => report.summary.find(s => s.key === key).value;
  // in: 100,000 (AR) + 3,000 (revenue); out: 36,800 + 10,000 (suppliers); the 5,000 transfer and the
  // truck bought on credit move no cash.
  assert.equal(value('operating'), 56200);
  assert.equal(value('investing'), 0);
  assert.equal(value('financing'), 0);
  assert.equal(value('opening'), 1000000);
  assert.equal(value('closing'), 1056200);
  allChecksOk(report);
  const operating = report.sections.find(s => s.key === 'operating');
  assert.deepEqual(rowOf(operating, A.ar.code), { code: A.ar.code, name: A.ar.name, nameAr: null, inflow: 100000, outflow: 0, net: 100000 });
  assert.equal(rowOf(operating, A.suppliers.code).outflow, 46800);
  assert.match(report.notes[1].en, /1 entry, 5000/);
  // The capital contribution falls in a period that includes 2025 -> financing.
  const all = await R['cash-flow']({ from: '2025-01-01', to: '2026-06-30' });
  assert.equal(all.summary.find(s => s.key === 'financing').value, 1000000);
});

test('Statement of Changes in Equity reconciles with the Statement of Financial Position', async () => {
  const report = await R['changes-in-equity'](PERIOD);
  const rows = report.sections[0].rows;
  const capital = rows.find(r => r.code === '20000001');
  assert.deepEqual([capital.opening, capital.contributions, capital.closing], [1000000, 0, 1000000]);
  const profit = rows.find(r => r.code === '');
  assert.deepEqual([profit.opening, profit.profit, profit.closing], [0, 141000, 141000]);
  assert.equal(report.sections[0].totals.closing, 1141000);
  allChecksOk(report);
  const withContribution = await R['changes-in-equity']({ from: '2025-01-01', to: '2026-06-30' });
  assert.equal(withContribution.sections[0].rows.find(r => r.code === '20000001').contributions, 1000000);
});

test('Projects, status counts and sectors come from the project records', async () => {
  const status = await R['projects-status']({});
  const p1 = status.sections[0].rows.find(r => r.projectNumber === 'PRJ001');
  assert.deepEqual([p1.contractValue, p1.executedPercentage, p1.executedAmount, p1.remainingAmount, p1.sector], [1000000, 20, 200000, 800000, 'Villa']);
  const p3 = status.sections[0].rows.find(r => r.projectNumber === 'PRJ003');
  assert.equal(p3.executedAmount, null, 'no contract value -> not available, not zero');

  const byStatus = await R['projects-by-status']({});
  assert.deepEqual(Object.fromEntries(byStatus.sections[0].rows.map(r => [r.status, r.count])), { Active: 1, Completed: 1, Cancelled: 0, 'On Hold': 1 });
  allChecksOk(byStatus);

  const bySector = await R['projects-by-sector']({});
  const sectors = Object.fromEntries(bySector.sections[0].rows.map(r => [r.sector, [r.projects, r.sectorStatus]]));
  assert.deepEqual(sectors, { Industrials: [1, 'Inactive'], Villa: [1, 'Active'], 'No sector': [1, null] });
});

test('Project / sector / customer profitability reconcile with each other and with the P&L', async () => {
  const projects = await R['project-profitability'](PERIOD);
  const rows = projects.sections[0].rows;
  const p1 = rows.find(r => r.projectNumber === 'PRJ001');
  assert.deepEqual([p1.revenue, p1.costOfSales, p1.grossProfit, p1.grossMargin], [200000, 50000, 150000, 75]);
  const p2 = rows.find(r => r.projectNumber === 'PRJ002');
  assert.equal(p2.revenue, 0, 'the reversed revenue nets to zero');
  const unlinked = rows.find(r => r._rowType === 'muted');
  assert.deepEqual([unlinked.revenue, unlinked.otherExpenses], [3000, 12000]);
  assert.equal(projects.sections[0].totals.revenue, 203000, '= P&L revenue');

  const sectors = await R['sector-profitability'](PERIOD);
  const villa = sectors.sections[0].rows.find(r => r.sector === 'Villa');
  assert.equal(villa.grossProfit, 150000);
  assert.equal(sectors.sections[0].totals.grossProfit, 150000, 'sum of the projects (lines without a project belong to no sector)');

  const customers = await R['customer-profitability'](PERIOD);
  const delta = customers.sections[0].rows.find(r => r.customer === 'Delta Builders');
  assert.deepEqual([delta.revenue, delta.grossProfit, delta.projects], [200000, 150000, 1]);
  assert.equal(customers.sections[0].totals.revenue, 203000);
});

test('Cash flows by project / sector use actual cash lines and reconcile with the Cash Flow Statement', async () => {
  const projects = await R['project-cash-flows'](PERIOD);
  const p1 = projects.sections[0].rows.find(r => r.projectNumber === 'PRJ001');
  assert.deepEqual([p1.inflow, p1.outflow, p1.net], [100000, 0, 100000]);
  const unlinked = projects.sections[0].rows.find(r => r._rowType === 'muted');
  assert.deepEqual([unlinked.inflow, unlinked.outflow], [3000, 46800]);
  assert.equal(projects.sections[0].totals.net, 56200, '= net change in cash');
  const sectors = await R['sector-cash-flows'](PERIOD);
  assert.equal(sectors.sections[0].rows.find(r => r.sector === 'Villa').net, 100000);
});

test('Customer and supplier balances come from the control accounts and reconcile with them', async () => {
  const customers = await R['customer-balances'](PERIOD);
  const delta = customers.sections[0].rows.find(r => r.partyNumber === c1.customerNumber);
  assert.deepEqual([delta.opening, delta.debit, delta.credit, delta.closing], [0, 228000, 100000, 128000]);
  const nile = customers.sections[0].rows.find(r => r.partyNumber === c2.customerNumber);
  assert.deepEqual([nile.debit, nile.credit, nile.closing], [50000, 50000, 0]);
  allChecksOk(customers);
  const byProject = await R['customer-balances']({ ...PERIOD, byProject: 'true' });
  assert.equal(byProject.sections[0].rows.find(r => r.partyNumber === c1.customerNumber).projectNumber, 'PRJ001');
  const one = await R['customer-balances']({ ...PERIOD, customer: String(c1._id) });
  assert.equal(one.sections[0].rows.length, 1);

  const suppliers = await R['supplier-balances'](PERIOD);
  const steel = suppliers.sections[0].rows[0];
  assert.deepEqual([steel.partyNumber, steel.debit, steel.credit, steel.closing], [v1.vendorNumber, 46800, 146800, 100000]);
  allChecksOk(suppliers);
});

test('Aging: FIFO open items with partial payments, buckets by days past the credit terms', async () => {
  const customers = await R['customer-aging']({ asOf: '2026-06-30' });
  const delta = customers.sections[0].rows.find(r => r.partyNumber === c1.customerNumber);
  // 228,000 on 2026-02-01 less 100,000 paid -> 128,000 open, 149 days old.
  assert.equal(delta.d90plus, 128000);
  assert.equal(customers.sections[0].rows.some(r => r.partyNumber === c2.customerNumber), false, 'fully reversed -> nothing open');
  allChecksOk(customers);
  const withTerms = await R['customer-aging']({ asOf: '2026-06-30', termDays: '140' });
  assert.equal(withTerms.sections[0].rows.find(r => r.partyNumber === c1.customerNumber).d1_30, 128000);

  const suppliers = await R['supplier-aging']({ asOf: '2026-06-30' });
  const steel = suppliers.sections[0].rows[0];
  // 136,800 (Jan 10) + 10,000 (Apr 1) less 46,800 paid, oldest first: 90,000 from Jan 10, 10,000 from Apr 1 (90 days).
  assert.deepEqual([steel.d90plus, steel.d61_90, steel.outstanding], [90000, 10000, 100000]);
  allChecksOk(suppliers);
});

test('Sales / purchase order lists and sales order profitability', async () => {
  const orders = await R['sales-orders'](PERIOD);
  const so = orders.sections[0].rows[0];
  assert.deepEqual([so.code, so.subtotal, so.vat, so.withholding, so.total, so.paid, so.outstanding, so.projectNumber], ['SO-0001', 200000, 28000, 0, 228000, 100000, 128000, 'PRJ001']);
  const profit = await R['sales-order-profitability'](PERIOD);
  const p = profit.sections[0].rows[0];
  // ledger revenue 200,000 and cost 50,000 of SO-0001's own entries; items cost 400 x 100 = 40,000.
  assert.deepEqual([p.revenue, p.costOfSales, p.grossProfit, p.grossMargin, p.itemsCost, p.itemsMargin], [200000, 50000, 150000, 75, 40000, 80]);

  const pos = await R['purchase-orders'](PERIOD);
  const po = pos.sections[0].rows[0];
  assert.deepEqual([po.code, po.subtotal, po.vat, po.withholding, po.total, po.outstanding, po.itemTypes], ['PO-0001', 1000, 140, 10, 1130, 1000, 'Services']);
  assert.equal((await R['sales-orders']({ from: '2026-03-01', to: '2026-06-30' })).sections[0].rows.length, 0, 'outside the dates');
});

test('Bank and cash statement: per-account movements, running balance, internal transfers flagged', async () => {
  const report = await R['bank-cash'](PERIOD);
  const [summary, movements] = report.sections;
  assert.deepEqual(summary.rows.map(r => [r.code, r.opening, r.debit, r.credit, r.closing]), [
    ['11000001', 1000000, 103000, 51800, 1051200],
    ['11000002', 0, 5000, 0, 5000],
  ]);
  assert.equal(movements.rows.length, 6, '5 bank lines + 1 safe line; the draft and July entries are excluded');
  const bankRows = movements.rows.filter(r => r.account.startsWith('11000001'));
  assert.equal(bankRows.at(-1).balance, 1051200);
  assert.equal(movements.rows.filter(r => r.type === 'Internal transfer').length, 2);
  assert.match(bankRows.find(r => r.debit === 100000).projectNumber, /PRJ001/);
  assert.match(bankRows.find(r => r.credit === 10000).counterparty, new RegExp(`${v1.vendorNumber} - Steel Co`));
  allChecksOk(report);
  const one = await R['bank-cash']({ ...PERIOD, account: String(A.safe._id) });
  assert.equal(one.sections[0].rows.length, 1);
  await assert.rejects(() => R['bank-cash']({ ...PERIOD, account: String(A.rent._id) }), /not a Cash/);
});

test('Expenses by account: amounts, counterpart accounts, percentages of the total', async () => {
  const report = await R['expenses-by-account'](PERIOD);
  const [accounts, lines] = report.sections;
  assert.deepEqual(accounts.rows.map(r => [r.code, r.amount, r.share]), [
    ['61000001', 10000, 83.33],
    ['62000001', 2000, 16.67],
  ]);
  assert.match(rowOf(accounts, '61000001').counterpart, /Suppliers \(10000\)/);
  assert.equal(accounts.totals.amount, 12000, '= P&L expenses; the draft is excluded');
  assert.equal(lines.rows.find(r => r.code === '61000001').description, 'Office rent April');
  allChecksOk(report);
  const empty = await R['expenses-by-account']({ from: '2024-01-01', to: '2024-12-31' });
  assert.equal(empty.sections[0].totals.share, null, 'zero total -> no division');
});

test('Fixed assets register and depreciation by asset follow the depreciation journal entries', async () => {
  const register = await R['fixed-asset-register']({ asOf: '2026-06-30' });
  const truck = register.sections[0].rows[0];
  assert.deepEqual([truck.cost, truck.accumulated, truck.netBookValue, truck.assetAccount], [120000, 2000, 118000, '12000001 - Vehicles']);
  allChecksOk(register);
  const april = await R['fixed-asset-register']({ asOf: '2026-04-30' });
  assert.equal(april.sections[0].rows[0].accumulated, 0, 'May depreciation not yet posted on April 30');
  const before = await R['fixed-asset-register']({ asOf: '2026-01-01' });
  assert.equal(before.sections[0].rows.length, 0, 'acquired after the as-of date');

  const dep = await R['depreciation-by-asset'](PERIOD);
  assert.deepEqual(dep.sections[0].rows.map(r => [r.month, r.kind, r.amount, r.accumulatedToDate, r.expenseAccount]), [['2026-05', 'Depreciation', 2000, 2000, '62000001 - Depreciation & Amortization']]);
});

test('Disclosure notes combine calculated notes with manually maintained text', async () => {
  await DisclosureNote.create({ title: 'Basis of preparation', titleAr: 'أسس الإعداد', body: 'Prepared on the accrual basis.', sortOrder: 1 });
  const report = await R['disclosure-notes']({ asOf: '2026-06-30' });
  const section = key => report.sections.find(s => s.key === key);
  assert.equal(section('cash').totals.closing, 1056200);
  assert.deepEqual(section('fixedAssets').rows.map(r => [r.cost, r.accumulated, r.netBookValue]), [[120000, 2000, 118000]]);
  assert.equal(section('receivables').totals.closing, 128000);
  assert.equal(section('payables').totals.closing, 100000);
  assert.equal(section('manual').rows[0].title, 'Basis of preparation');
  assert.equal(section('manual').manual, true);
});

test('Reports never change data, validate their input and export every row', async () => {
  const counts = async () => Promise.all(['journalentries', 'chartofaccounts', 'fixedassets', 'salesorders', 'purchaseorders', 'projects'].map(c => mongoose.connection.collection(c).countDocuments()));
  const beforeCounts = await counts();
  const { REPORTS } = require('../../services/reports/reportRegistry');
  for (const r of REPORTS) await r.run(r.kind === 'asOf' ? { asOf: '2026-06-30' } : PERIOD);
  assert.deepEqual(await counts(), beforeCounts);

  await assert.rejects(() => runReport('nope', {}), /Unknown report/);
  await assert.rejects(() => R['trial-balance']({ from: '2026-07-01', to: '2026-06-30' }), /start date must be on or before/);
  await assert.rejects(() => R['trial-balance']({ from: '2026-13-01', to: '2026-06-30' }), /not a valid date|YYYY-MM-DD/);
  await assert.rejects(() => R['customer-aging']({ asOf: '2026-06-30', termDays: '-1' }), /Invalid credit terms/);

  const result = await runReport('bank-cash', PERIOD);
  const workbook = await buildWorkbook(result, 'ar');
  const movementsSheet = workbook.worksheets[1];
  assert.equal(movementsSheet.views[0].rightToLeft, true);
  let headerIndex = 0;
  movementsSheet.eachRow((row, index) => {
    if (row.values.includes('الرصيد الجاري')) headerIndex = index;
  });
  assert.ok(headerIndex > 0, 'Arabic column headers');
  assert.equal(movementsSheet.getRow(1).values[1], 'بيان بالبنوك وما في حكمها وحركة كل بنك وأرصدته');
  // after the header: all 6 movement rows (never just one page) + the totals row
  assert.equal(movementsSheet.rowCount, headerIndex + 6 + 1);
});

test('Report routes require sign-in and the reports permission', async () => {
  const router = require('../../routes/accountingReportsRoute');
  const authController = require('../../controller/user/authController');
  assert.equal(router.stack[0].handle, authController.protect, 'every route is behind protect');
  const permission = router.stack[1].handle;
  const call = user =>
    new Promise(resolve => {
      permission({ user }, {}, err => resolve(err || null));
    });
  assert.equal((await call({ role: 'user', permissions: [] }))?.statusCode, 403);
  assert.equal(await call({ role: 'user', permissions: [{ resource: 'reports', actions: ['read'] }] }), null);
  assert.equal(await call({ role: 'admin', permissions: [] }), null);

  // No fixed route may shadow a report (e.g. a notes route named like the "disclosure-notes" report).
  const { REPORTS } = require('../../services/reports/reportRegistry');
  const fixedPaths = router.stack.filter(layer => layer.route && !layer.route.path.includes(':')).map(layer => layer.route.path.split('/')[1]);
  REPORTS.forEach(r => assert.equal(fixedPaths.includes(r.key), false, `"/${r.key}" is reachable as a report`));
});

test('A reversed depreciation entry is removed from accumulated depreciation and shown as a negative movement', async () => {
  await JournalEntry.collection.updateOne({ _id: asset.e10._id }, { $set: { status: 'reversed' } });
  await JournalEntry.collection.insertOne({ _id: id(), entryNumber: (entryNo += 1), date: new Date('2026-06-15T10:00:00Z'), status: 'posted', reversalOfEntry: asset.e10._id, lines: [{ account: A.accDep._id, debit: 2000, credit: 0 }, { account: A.depExp._id, debit: 0, credit: 2000 }], totalDebit: 2000, totalCredit: 2000 });
  const register = await R['fixed-asset-register']({ asOf: '2026-06-30' });
  assert.deepEqual([register.sections[0].rows[0].accumulated, register.sections[0].rows[0].netBookValue], [0, 120000]);
  allChecksOk(register);
  const dep = await R['depreciation-by-asset'](PERIOD);
  assert.deepEqual(dep.sections[0].rows.map(r => [r.kind, r.amount]), [
    ['Depreciation', 2000],
    ['Reversal', -2000],
  ]);
  assert.equal(dep.sections[0].totals.amount, 0);
  const pl = await R['profit-loss'](PERIOD);
  assert.equal(pl.summary.find(s => s.key === 'expenses').value, 10000, 'the reversal also clears the P&L');
});

test('An expense with several counterpart lines is split across them without double counting', async () => {
  await JournalEntry.collection.insertOne({ _id: id(), entryNumber: (entryNo += 1), date: new Date('2026-06-25T10:00:00Z'), status: 'posted', description: 'Split rent', lines: [{ account: A.rent._id, debit: 1000, credit: 0 }, { account: A.bank._id, debit: 0, credit: 400 }, { account: A.suppliers._id, debit: 0, credit: 600 }], totalDebit: 1000, totalCredit: 1000 });
  const report = await R['expenses-by-account']({ from: '2026-06-21', to: '2026-06-30' });
  const [accounts, lines] = report.sections;
  assert.equal(accounts.totals.amount, 1000);
  assert.match(lines.rows[0].counterpart, /Bank Misr \(400\).*Suppliers \(600\)/);
});
