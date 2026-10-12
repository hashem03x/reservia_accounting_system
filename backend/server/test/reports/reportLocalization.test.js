const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Financial Reports localization: every report in the catalog, run over a full ledger and shown the
// way the Financial Reports page shows it (title, sections, column labels, cells with their `Ar`
// variants, group headers, summary, checks, notes), must be in ONE language. In Arabic no English UI
// text may appear and in English no Arabic UI text. The fixture's own data (customers, vendors,
// projects, assets, sectors, descriptions) is Arabic and the accounts carry an Arabic name, so any
// Latin word in the Arabic view comes from the report itself; in the English view that Arabic data is
// removed before checking, since data is shown as entered.

const DB_URI = process.env.TEST_DB_URI_REPORT_LOCALIZATION || 'mongodb://127.0.0.1:27017/reversia_test_report_localization';

let JournalEntry, ChartOfAccount, Project, Sector, User, Vendor, SalesOrder, PurchaseOrder, FixedAsset, Product;
let runReport, catalog;
const A = {};
const P = {};
let entryNo = 700000;
const id = () => new mongoose.Types.ObjectId();
const PERIOD = { from: '2026-01-01', to: '2026-06-30' };

// Arabic fixture data (shown as entered in both languages).
const DATA = ['شركة الدلتا للمقاولات', 'شركة النيل للإسكان', 'شركة الحديد', 'فيلا', 'صناعي', 'مشروع الفيلا', 'مشروع المصنع', 'مشروع معلق', 'سيارة نقل', 'قيد تجريبي', 'إيجار المكتب', 'تصميم'];

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
  require('../../models/equity/shareholderModel');
  ({ runReport } = require('../../controller/reports/accountingReportsController'));
  ({ catalog } = require('../../services/reports/reportRegistry'));

  const { AutomaticJournalAccountCodes: CODES } = require('../../utils/accountingConstants');
  const GROUP_AR = { 'Cash & Cash Equivalents': 'النقدية وما في حكمها', Receivables: 'المدينون', 'Current Liabilities': 'الالتزامات المتداولة', 'Property, Plant & Equipment': 'الأصول الثابتة', 'Operating Expenses': 'المصروفات التشغيلية', Equity: 'حقوق الملكية', Revenue: 'الإيرادات', 'Cost of Sales': 'تكلفة المبيعات', 'Projects Under Construction': 'مشروعات تحت التنفيذ' };
  const account = (key, code, name, nameAr, type, parentGroupNameEn) => ChartOfAccount.create({ code, name, nameAr, type, parentGroupNameEn, parentGroupNameAr: GROUP_AR[parentGroupNameEn] }).then(a => (A[key] = a));
  await account('bank', '11000001', 'Bank Misr', 'بنك مصر', 'asset', 'Cash & Cash Equivalents');
  await account('safe', '11000002', 'Main Safe', 'الخزينة الرئيسية', 'asset', 'Cash & Cash Equivalents');
  await account('ar', CODES.accountsReceivableProjects, 'Accounts Receivable (Projects)', 'عملاء المشروعات', 'asset', 'Receivables');
  await account('custAdv', CODES.customerAdvancesPayable, 'Advances from Customers', 'دفعات مقدمة من العملاء', 'liability', 'Current Liabilities');
  await account('suppliers', CODES.suppliers, 'Suppliers', 'الموردون', 'liability', 'Current Liabilities');
  await account('supAdv', CODES.advanceToSuppliers, 'Advances to Suppliers', 'دفعات مقدمة للموردين', 'asset', 'Receivables');
  await account('inputVat', CODES.inputVat, 'Input VAT', 'ضريبة المدخلات', 'asset', 'Receivables');
  await account('vat', CODES.vatPayable, 'VAT Payable', 'ضريبة القيمة المضافة المستحقة', 'liability', 'Current Liabilities');
  await account('truck', '12000001', 'Vehicles', 'السيارات', 'asset', 'Property, Plant & Equipment');
  await account('accDep', '12000099', 'Accumulated Depreciation – Fixed Assets', 'مجمع إهلاك الأصول الثابتة', 'asset', 'Property, Plant & Equipment');
  await account('depExp', '62000001', 'Depreciation & Amortization', 'الإهلاك والاستهلاك', 'expense', 'Operating Expenses');
  await account('rent', '61000001', 'Office Rent', 'إيجار المكتب', 'expense', 'Operating Expenses');
  await account('capital', '20000001', 'Share Capital', 'رأس المال', 'equity', 'Equity');
  await account('revenue', CODES.revenue, 'Revenue', 'الإيرادات', 'revenue', 'Revenue');
  await account('cogs', '50000001', 'Raw Materials', 'خامات', 'cogs', 'Cost of Sales');
  await account('wip', CODES.wipRawMaterials, 'PUC - Raw Materials', 'مشروعات تحت التنفيذ - خامات', 'asset', 'Projects Under Construction');

  const c1 = await User.create({ name: DATA[0], email: `c1-${Date.now()}@example.com`, role: 'user', type: 'online' });
  const c2 = await User.create({ name: DATA[1], email: `c2-${Date.now()}@example.com`, role: 'user', type: 'online' });
  const v1 = await Vendor.create({ name: DATA[2], contact: { phone: `010${Date.now()}`.slice(0, 11) } });
  await Sector.collection.insertMany([{ name: DATA[3], isActive: true }, { name: DATA[4], isActive: false }]);
  const project = (key, number, name, customer, sector, status, contractValue, executedPercentage) => {
    P[key] = { _id: id(), projectNumber: number };
    return Project.collection.insertOne({ _id: P[key]._id, projectNumber: number, name, customer: customer?._id || null, sector, status, contractValue, executedPercentage, startDate: new Date('2026-01-01'), deliveryDate: new Date('2026-12-31'), isDeleted: false });
  };
  await project('p1', 'PRJ001', DATA[5], c1, DATA[3], 'active', 1000000, 20);
  await project('p2', 'PRJ002', DATA[6], c2, DATA[4], 'completed', 500000, 10);
  await project('p3', 'PRJ003', DATA[7], null, null, 'on_hold', null, 0);

  const line = (acc, debit, credit, extra = {}) => ({ account: A[acc]._id, debit, credit, description: DATA[9], ...extra });
  const onP = key => ({ project: P[key]._id, projectNumber: P[key].projectNumber });
  const cust = c => ({ partyNumber: c.customerNumber, partyType: 'customer' });
  const vend = { partyNumber: v1.vendorNumber, partyType: 'vendor' };
  const je = async (date, lines, extra = {}) => {
    const doc = { _id: id(), entryNumber: (entryNo += 1), date: new Date(date), description: DATA[9], status: 'posted', source: 'automatic', lines, totalDebit: lines.reduce((s, l) => s + l.debit, 0), totalCredit: lines.reduce((s, l) => s + l.credit, 0), ...extra };
    await JournalEntry.collection.insertOne(doc);
    return doc;
  };
  const so1 = id();
  await je('2025-12-01T10:00:00Z', [line('bank', 1000000, 0), line('capital', 0, 1000000)], { accountingAction: 'SHAREHOLDER_CONTRIBUTION' });
  const e2 = await je('2026-01-10T10:00:00Z', [line('truck', 120000, 0, vend), line('inputVat', 16800, 0, vend), line('suppliers', 0, 136800, vend)], { accountingAction: 'FIXED_ASSET_ACQUISITION' });
  await je('2026-02-01T10:00:00Z', [line('ar', 228000, 0, { ...onP('p1'), ...cust(c1) }), line('revenue', 0, 200000, { ...onP('p1'), ...cust(c1) }), line('vat', 0, 28000, { ...onP('p1'), ...cust(c1) })], { accountingAction: 'PROJECT_REVENUE_RECOGNITION', triggeredBySalesOrder: so1, project: P.p1._id });
  await je('2026-02-01T10:00:01Z', [line('cogs', 50000, 0, onP('p1')), line('wip', 0, 50000, onP('p1'))], { accountingAction: 'PROJECT_COST_RECOGNITION', triggeredBySalesOrder: so1, project: P.p1._id });
  await je('2026-01-20T10:00:00Z', [line('wip', 60000, 0, onP('p1')), line('suppliers', 0, 60000, vend)], { accountingAction: 'PO_INVENTORY_TO_WIP' });
  await je('2026-03-01T10:00:00Z', [line('bank', 100000, 0, onP('p1')), line('ar', 0, 100000, { ...onP('p1'), ...cust(c1) })], { accountingAction: 'SO_PAYMENT_RECORDED' });
  await je('2026-03-15T10:00:00Z', [line('suppliers', 36800, 0, vend), line('bank', 0, 36800)], { accountingAction: 'PO_PAYMENT_RECORDED' });
  await je('2026-04-01T10:00:00Z', [line('rent', 10000, 0, { ...vend, ...onP('p1') }), line('suppliers', 0, 10000, vend)], { accountingAction: 'EXPENSE_RECORDED', description: DATA[10] });
  await je('2026-04-02T10:00:00Z', [line('suppliers', 10000, 0, vend), line('bank', 0, 10000, vend)], { accountingAction: 'EXPENSE_PAYMENT_RECORDED' });
  await je('2026-05-01T10:00:00Z', [line('safe', 5000, 0), line('bank', 0, 5000)]);
  const e10 = await je('2026-05-31T12:00:00Z', [line('depExp', 2000, 0), line('accDep', 0, 2000)], { accountingAction: 'FIXED_ASSET_DEPRECIATION' });
  const e11 = await je('2026-06-01T10:00:00Z', [line('ar', 50000, 0, { ...onP('p2'), ...cust(c2) }), line('revenue', 0, 50000, { ...onP('p2'), ...cust(c2) })], { accountingAction: 'PROJECT_REVENUE_RECOGNITION', project: P.p2._id, status: 'reversed' });
  await je('2026-06-10T10:00:00Z', [line('revenue', 50000, 0, { ...onP('p2'), ...cust(c2) }), line('ar', 0, 50000, { ...onP('p2'), ...cust(c2) })], { reversalOfEntry: e11._id, project: P.p2._id });
  await je('2026-06-15T10:00:00Z', [line('rent', 999, 0), line('bank', 0, 999)], { status: 'draft' });
  await je('2026-06-20T10:00:00Z', [line('bank', 3000, 0), line('revenue', 0, 3000)]);

  await SalesOrder.collection.insertOne({ _id: so1, code: 'SO-0001', customer: c1._id, project: P.p1._id, orderSource: 'cashier', orderStatus: 'pending', paymentStatus: 'partial', createdAt: new Date('2026-02-01T09:00:00Z'), totalAmount: 200000, vatAmount: 28000, withholdingTaxAmount: 0, grandTotal: 228000, paidAmount: 100000, items: [{ product: id(), unitPrice: 2000, starterQuantity: 100, returnedQuantity: 0, costWhenSold: 400 }] });
  const service = id();
  await Product.collection.insertOne({ _id: service, type: 'service', title: { en: 'Design', ar: DATA[11] } });
  await PurchaseOrder.collection.insertOne({ _id: id(), code: 'PO-0001', vendorId: v1._id, project: P.p1._id, createdAt: new Date('2026-03-01T09:00:00Z'), totalAmount: 1000, vatAmount: 140, withholdingTaxAmount: 10, grandTotal: 1130, paidAmount: 130, paymentStatus: 'partial', items: [{ productId: service, unitPrice: 1000, starterQuantity: 1 }] });
  await FixedAsset.collection.insertOne({
    _id: id(),
    name: DATA[8],
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
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

const TEXT_TYPES = new Set(['money', 'number', 'percent', 'date']);

/** Every piece of text the Financial Reports page shows for `result` in one language. */
function displayedText(result, isArabic) {
  const pick = t => (t ? (isArabic ? t.ar : t.en) : '');
  const cell = (row, key) => (isArabic && row[`${key}Ar`] != null ? row[`${key}Ar`] : row[key]);
  const out = [];
  const push = (where, value) => typeof value === 'string' && value && out.push({ where, value });
  push('title', pick(result.title));
  push('category', pick(result.categoryTitle));
  result.summary.forEach(s => push('summary', pick(s.label)));
  result.checks.forEach(c => {
    push('check', pick(c.label));
    push('check detail', isArabic ? c.detailAr ?? c.detail : c.detail);
  });
  result.notes.forEach(n => push('note', pick(n)));
  for (const section of result.sections) {
    push('section', pick(section.title));
    section.columns.forEach(c => push(`column ${section.key}`, pick(c.label)));
    for (const row of [...section.rows, ...(section.totals ? [section.totals] : [])]) {
      if (row._rowType === 'header') {
        push(`header ${section.key}`, isArabic ? row.nameAr ?? row.name : row.name);
        continue;
      }
      for (const c of section.columns) if (!TEXT_TYPES.has(c.type)) push(`${section.key}.${c.key}`, cell(row, c.key));
    }
  }
  return out;
}

// Identifiers and codes may stay as they are: account / document / project numbers, the currency.
const IDENTIFIER = /^[A-Z0-9][A-Z0-9_./#-]*\d[A-Z0-9_./#-]*$|^(EGP|-)$/;
const latinWords = text => (text.match(/[A-Za-z][A-Za-z0-9_./#'’-]*/g) || []).filter(w => !IDENTIFIER.test(w));
// Longest first, so a name containing another ("مشروع الفيلا" / "فيلا") is removed whole.
const withoutData = text => [...DATA].sort((a, b) => b.length - a.length).reduce((t, d) => t.split(d).join(''), text);

async function everyReport() {
  const keys = catalog().categories.flatMap(c => c.reports.map(r => [r.key, r.kind]));
  const results = [];
  for (const [key, kind] of keys) {
    // eslint-disable-next-line no-await-in-loop
    results.push(await runReport(key, kind === 'asOf' ? { asOf: '2026-06-30' } : PERIOD));
  }
  return results;
}

test('Arabic: no English UI text in any report', async () => {
  const problems = [];
  for (const result of await everyReport()) {
    for (const { where, value } of displayedText(result, true)) {
      const words = latinWords(value);
      if (words.length) problems.push(`${result.key} / ${where}: "${value}" (${words.join(', ')})`);
    }
  }
  assert.deepEqual([...new Set(problems)], []);
});

test('English: no Arabic UI text in any report', async () => {
  const problems = [];
  for (const result of await everyReport()) {
    for (const { where, value } of displayedText(result, false)) {
      if (/[؀-ۿ]/.test(withoutData(value))) problems.push(`${result.key} / ${where}: "${value}"`);
    }
  }
  assert.deepEqual([...new Set(problems)], []);
});

test('report validation errors are returned in the language of the request', async () => {
  const router = require('../../routes/accountingReportsRoute');
  const localize = router.stack.find(l => l.handle.length === 4).handle;
  const errorFor = async (query, lang) => {
    const err = await runReport('trial-balance', query).catch(e => e);
    let sent;
    localize(err, { headers: { 'accept-language': lang } }, {}, e => (sent = e));
    return sent.message;
  };
  assert.match(await errorFor({ from: '2026-07-01', to: '2026-06-30' }, 'ar'), /^يجب أن يكون تاريخ البداية/);
  assert.match(await errorFor({ from: '2026-07-01', to: '2026-06-30' }, 'en'), /^The start date must be on or before/);
  assert.match(await errorFor({ from: '2026-13-01', to: '2026-06-30' }, 'ar'), /تاريخ البداية/);
  const err = await runReport('customer-aging', { asOf: '2026-06-30', termDays: '-1' }).catch(e => e);
  assert.equal(err.details.messageAr, 'قيمة مدة الائتمان (بالأيام) غير صالحة.');
});
