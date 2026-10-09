const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Financial Analytics dashboard (services/analytics/financialDashboardService.js) against one
// explicit ledger. Every expected figure is worked out by hand in the comments; the dashboard must
// also equal the Financial Reports for the same dates.

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_financial_dashboard';

let JournalEntry, ChartOfAccount, financialDashboard, previousPeriod, REPORTS_BY_KEY;
const A = {};
let entryNo = 700000;
const id = () => new mongoose.Types.ObjectId();
const Q1 = { from: '2026-01-01', to: '2026-03-31' };

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  JournalEntry = require('../../models/accounting/journalEntryModel');
  ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
  ({ financialDashboard, previousPeriod } = require('../../services/analytics/financialDashboardService'));
  ({ REPORTS_BY_KEY } = require('../../services/reports/reportRegistry'));
  const { AutomaticJournalAccountCodes: CODES } = require('../../utils/accountingConstants');

  const account = (key, code, name, type, state, parentGroupNameEn) => ChartOfAccount.create({ code, name, type, state, parentGroupNameEn }).then(a => (A[key] = a));
  await account('bank', '11000001', 'Bank Misr', 'asset', null, 'Cash & Cash Equivalents');
  await account('ar', CODES.accountsReceivableProjects, 'Accounts Receivable (Projects)', 'asset', 'current');
  await account('inputVat', CODES.inputVat, 'Input VAT', 'asset', 'current');
  await account('wip', CODES.wipRawMaterials, 'PUC - Raw Materials', 'asset', 'current');
  await account('truck', '12000001', 'Vehicles', 'asset', 'non-current', 'Property, Plant & Equipment');
  await account('accDep', '12000099', 'Accumulated Depreciation – Fixed Assets', 'asset', 'non-current', 'Property, Plant & Equipment');
  await account('suppliers', CODES.suppliers, 'Suppliers', 'liability', 'current');
  await account('vat', CODES.vatPayable, 'VAT Payable', 'liability', 'current');
  await account('loan', '32000001', 'Long-term Loan', 'liability', 'non-current');
  await account('capital', '20000001', 'Share Capital', 'equity');
  await account('revenue', CODES.revenue, 'Revenue', 'revenue');
  await account('cogs', '50000001', 'Raw Materials', 'cogs');
  await account('rent', '61000001', 'Office Rent', 'expense', 'operating');
  await account('depExp', '62000001', 'Depreciation & Amortization', 'expense', 'operating', 'Operating Expenses');

  const line = (acc, debit, credit) => ({ account: A[acc]._id, debit, credit });
  const je = async (date, lines, extra = {}) => {
    const doc = { _id: id(), entryNumber: (entryNo += 1), date: new Date(date), status: 'posted', source: 'automatic', description: 'x', lines, totalDebit: lines.reduce((s, l) => s + l.debit, 0), totalCredit: lines.reduce((s, l) => s + l.credit, 0), ...extra };
    await JournalEntry.collection.insertOne(doc);
    return doc;
  };
  // Previous quarter (Oct-Dec 2025): capital 1,000,000 and a 200,000 loan, both into the bank.
  await je('2025-12-01T10:00:00Z', [line('bank', 1000000, 0), line('capital', 0, 1000000)], { accountingAction: 'SHAREHOLDER_CONTRIBUTION' });
  await je('2025-12-15T10:00:00Z', [line('bank', 200000, 0), line('loan', 0, 200000)]);
  // Q1 2026
  await je('2026-01-10T10:00:00Z', [line('truck', 120000, 0), line('inputVat', 16800, 0), line('suppliers', 0, 136800)], { accountingAction: 'FIXED_ASSET_ACQUISITION' });
  await je('2026-02-01T10:00:00Z', [line('ar', 228000, 0), line('revenue', 0, 200000), line('vat', 0, 28000)], { accountingAction: 'PROJECT_REVENUE_RECOGNITION' });
  await je('2026-02-01T10:00:01Z', [line('cogs', 50000, 0), line('wip', 0, 50000)], { accountingAction: 'PROJECT_COST_RECOGNITION' });
  const sale = await je('2026-02-15T10:00:00Z', [line('ar', 30000, 0), line('revenue', 0, 30000)], { accountingAction: 'PROJECT_REVENUE_RECOGNITION', status: 'reversed' });
  await je('2026-02-20T10:00:00Z', [line('revenue', 30000, 0), line('ar', 0, 30000)], { reversalOfEntry: sale._id });
  await je('2026-03-01T10:00:00Z', [line('bank', 100000, 0), line('ar', 0, 100000)], { accountingAction: 'SO_PAYMENT_RECORDED' });
  await je('2026-03-10T10:00:00Z', [line('rent', 10000, 0), line('suppliers', 0, 10000)], { accountingAction: 'EXPENSE_RECORDED' });
  await je('2026-03-15T10:00:00Z', [line('suppliers', 46800, 0), line('bank', 0, 46800)], { accountingAction: 'PO_PAYMENT_RECORDED' });
  await je('2026-03-31T12:00:00Z', [line('depExp', 2000, 0), line('accDep', 0, 2000)], { accountingAction: 'FIXED_ASSET_DEPRECIATION' });
  await je('2026-03-20T10:00:00Z', [line('rent', 999, 0), line('bank', 0, 999)], { status: 'draft' });
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

const metricsOf = result => Object.fromEntries(result.groups.flatMap(g => g.metrics).map(m => [m.key, m]));

test('the comparison period is the preceding equivalent period', () => {
  assert.deepEqual(previousPeriod({ from: '2026-03-01', to: '2026-03-31' }), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(previousPeriod(Q1), { from: '2025-10-01', to: '2025-12-31' });
  assert.deepEqual(previousPeriod({ from: '2026-01-01', to: '2026-12-31' }), { from: '2025-01-01', to: '2025-12-31' });
  assert.deepEqual(previousPeriod({ from: '2026-03-10', to: '2026-03-19' }), { from: '2026-02-28', to: '2026-03-09' });
});

test('profitability: P&L figures (reversal nets to zero, draft excluded) and ROA / ROE on average balances', async () => {
  const m = metricsOf(await financialDashboard(Q1));
  // revenue 200,000 (the 30,000 sale was reversed); cost of sales 50,000; expenses 10,000 + 2,000
  assert.equal(m.grossProfit.value, 150000);
  assert.equal(m.grossMargin.value, 75);
  assert.equal(m.netProfit.value, 138000);
  assert.equal(m.netMargin.value, 69);
  // assets 1,200,000 -> 1,466,000 (avg 1,333,000); equity 1,000,000 -> 1,138,000 (avg 1,069,000)
  assert.equal(m.roa.value, 10.35);
  assert.equal(m.roe.value, 12.91);
  // previous quarter: no revenue -> margin not available, profit 0
  assert.equal(m.grossMargin.previous, null);
  assert.equal(m.netProfit.previous, 0);
  assert.equal(m.grossProfit.better, 'higher');
});

test('liquidity and solvency from the Chart of Accounts classification', async () => {
  const m = metricsOf(await financialDashboard(Q1));
  // current assets: bank 1,253,200 + AR 128,000 + input VAT 16,800 - WIP 50,000 = 1,348,000
  // current liabilities: suppliers 100,000 + VAT 28,000 = 128,000; non-current: loan 200,000
  assert.equal(m.currentRatio.value, 10.53);
  assert.equal(m.quickRatio.value, 10.79); // (1,253,200 + 128,000) / 128,000
  assert.equal(m.cash.value, 1253200);
  assert.equal(m.workingCapital.value, 1220000);
  assert.equal(m.debtToAssets.value, 0.22); // 328,000 / 1,466,000
  assert.equal(m.equityRatio.value, 0.78); // 1,138,000 / 1,466,000
  assert.equal(m.ltDebtToCapital.value, 0.15); // 200,000 / (200,000 + 1,138,000)
  assert.equal(m.totalLiabilities.value, 328000);
  assert.equal(m.totalEquity.value, 1138000);
  assert.equal(m.debtToEquity.value, 0.29); // 328,000 / 1,138,000
  assert.equal(m.debtToEquity.better, 'lower');
  assert.equal(m.cash.previous, 1200000);
});

test('debt service, interest coverage, inventory turnover, cash conversion cycle and ROI are reported as unavailable with a reason', async () => {
  const m = metricsOf(await financialDashboard(Q1));
  for (const key of ['interestCoverage', 'dscr', 'inventoryTurnover', 'cashConversionCycle', 'roi']) {
    assert.equal(m[key].value, null, key);
    assert.ok(m[key].reason?.en && m[key].reason?.ar, `${key} explains why`);
  }
});

test('efficiency: DSO and DPO from credit sales / purchases net of reversals', async () => {
  const m = metricsOf(await financialDashboard(Q1));
  // credit sales 228,000 (+30,000 reversed); average receivables (0 + 128,000) / 2; 90 days
  assert.equal(m.receivablesTurnover.value, 3.56);
  assert.equal(m.dso.value, 25.26);
  // credit purchases 136,800 + 10,000; average payables (0 + 100,000) / 2; 90 days
  assert.equal(m.dpo.value, 30.65);
});

test('advanced: EBITDA from classified expenses and free cash flow from the cash flow statement', async () => {
  const m = metricsOf(await financialDashboard(Q1));
  assert.equal(m.ebitda.value, 140000); // 200,000 - 50,000 - 12,000 + 2,000
  assert.equal(m.freeCashFlow.value, 53200); // operating 100,000 - 46,800; investing 0
  assert.equal(m.freeCashFlow.previous, 200000); // the loan (a liability) falls under operating; capital is financing
});

test('the dashboard equals the Financial Reports for the same dates', async () => {
  const dashboard = await financialDashboard(Q1);
  const pl = await REPORTS_BY_KEY.get('profit-loss').run(Q1);
  const position = await REPORTS_BY_KEY.get('financial-position').run({ asOf: Q1.to });
  const cash = await REPORTS_BY_KEY.get('cash-flow').run(Q1);
  const s = (report, key) => report.summary.find(x => x.key === key).value;
  assert.equal(dashboard.totals.revenue, s(pl, 'revenue'));
  assert.equal(dashboard.totals.netProfit, s(pl, 'netProfit'));
  assert.equal(dashboard.totals.totalAssets, s(position, 'totalAssets'));
  assert.equal(dashboard.totals.totalLiabilities, s(position, 'totalLiabilities'));
  assert.equal(dashboard.totals.totalEquity, s(position, 'totalEquity'));
  assert.equal(dashboard.totals.cash, s(cash, 'closing'));
  assert.equal(dashboard.totals.operating, s(cash, 'operating'));
});

test('trend series: monthly buckets that add up to the period totals', async () => {
  const { series, totals } = await financialDashboard(Q1);
  assert.equal(series.granularity, 'month');
  assert.deepEqual(series.points.map(p => p.key), ['2026-01', '2026-02', '2026-03']);
  const feb = series.points[1];
  assert.deepEqual([feb.revenue, feb.cogs, feb.grossProfit], [200000, 50000, 150000]);
  assert.equal(series.points[2].operating, 53200);
  assert.equal(series.points.reduce((sum, p) => sum + p.netProfit, 0), totals.netProfit);
  const month = await financialDashboard({ from: '2026-03-01', to: '2026-03-31' });
  assert.equal(month.series.granularity, 'day');
  assert.equal(month.series.points.length, 31);
});

test('empty periods, zero denominators and invalid input', async () => {
  const empty = await financialDashboard({ from: '2020-01-01', to: '2020-01-31' });
  const m = metricsOf(empty);
  assert.equal(empty.hasActivity, false);
  assert.equal(m.grossMargin.value, null);
  assert.equal(m.roa.value, null, 'no assets -> no ROA');
  assert.equal(m.debtToAssets.value, null);
  await assert.rejects(() => financialDashboard({ from: '2026-03-01', to: '2026-01-01' }), /start date must be on or before/);
  await assert.rejects(() => financialDashboard({ ...Q1, compareFrom: '2026-02-01', compareTo: '2026-02-28' }), /comparison period must end before/);
  await assert.rejects(() => financialDashboard({ from: '2000-01-01', to: '2026-01-01' }), /cannot exceed 10 years/);
});

test('the endpoint is admin-only like the rest of Analytics', async () => {
  const router = require('../../routes/analyticsRoute');
  const authController = require('../../controller/user/authController');
  assert.equal(router.stack[0].handle, authController.protect);
  const allowed = user => new Promise(resolve => router.stack[1].handle({ user }, {}, err => resolve(err || null)));
  assert.equal((await allowed({ role: 'user' }))?.statusCode, 403);
  assert.equal(await allowed({ role: 'admin' }), null);
  assert.ok(router.stack.some(l => l.route?.path === '/financial-dashboard'));
});

test('an unclassified account with a balance makes the classification ratios unavailable, naming the account', async () => {
  await ChartOfAccount.create({ code: '13000001', name: 'Prepaid Rent', type: 'asset' }).then(a => (A.prepaid = a));
  await JournalEntry.collection.insertOne({ _id: id(), entryNumber: (entryNo += 1), date: new Date('2026-03-30T10:00:00Z'), status: 'posted', lines: [{ account: A.prepaid._id, debit: 500, credit: 0 }, { account: A.bank._id, debit: 0, credit: 500 }], totalDebit: 500, totalCredit: 500 });
  const m = metricsOf(await financialDashboard(Q1));
  assert.equal(m.currentRatio.value, null);
  assert.match(m.currentRatio.reason.en, /13000001 Prepaid Rent/);
  assert.equal(m.workingCapital.value, null);
  // The quick ratio only needs the liabilities classified: (1,252,700 + 128,000) / 128,000.
  assert.equal(m.quickRatio.value, 10.79);
  assert.equal(m.debtToAssets.value, 0.22, 'totals do not need the classification');
});
