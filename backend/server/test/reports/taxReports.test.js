const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Taxes reports (services/reports/taxReports.js) against one explicit ledger. Every expected figure
// is worked out by hand from the entries below, never copied from the code under test.

const DB_URI = process.env.TEST_DB_URI_TAX || 'mongodb://127.0.0.1:27017/reversia_test_tax_reports';

let JournalEntry, ChartOfAccount, Project, User, Vendor, SalesOrder, PurchaseOrder, Expense;
let R; // report functions by key
let runReport, buildWorkbook;
const A = {}; // accounts
const E = {}; // entries
let c1, c2, v1, so1, so2, po1, ex1, p1;
let entryNo = 700000;
const id = () => new mongoose.Types.ObjectId();
const PERIOD = { from: '2026-01-01', to: '2026-06-30' };

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  require('../../models/inventory/warehouseModel');
  require('../../models/vendor/paymentModel');
  JournalEntry = require('../../models/accounting/journalEntryModel');
  ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
  Project = require('../../models/project/projectModel');
  User = require('../../models/userModel');
  Vendor = require('../../models/vendor/vendor');
  SalesOrder = require('../../models/sales/salesOrderModel');
  PurchaseOrder = require('../../models/vendor/purchaseOrder');
  Expense = require('../../models/expense/expenseModel');
  require('../../models/equity/shareholderModel');
  const { REPORTS_BY_KEY } = require('../../services/reports/reportRegistry');
  R = Object.fromEntries([...REPORTS_BY_KEY].map(([k, r]) => [k, r.run]));
  ({ runReport, buildWorkbook } = require('../../controller/reports/accountingReportsController'));

  const { AutomaticJournalAccountCodes: CODES } = require('../../utils/accountingConstants');
  const account = (key, code, name, nameAr, type, parentGroupNameEn = null) => ChartOfAccount.create({ code, name, nameAr, type, parentGroupNameEn }).then(a => (A[key] = a));
  await account('bank', '11000001', 'Bank Misr', 'بنك مصر', 'asset', 'Cash & Cash Equivalents');
  await account('ar', CODES.accountsReceivableProjects, 'Accounts Receivable (Projects)', null, 'asset');
  await account('suppliers', CODES.suppliers, 'Suppliers', null, 'liability');
  await account('revenue', CODES.revenue, 'Revenue', null, 'revenue');
  await account('inventory', CODES.materialsInventory, 'Materials Inventory', null, 'asset');
  await account('rent', '61000001', 'Office Rent', null, 'expense');
  // Tax accounts: the four the automatic entries post to, plus accounts found only by name.
  await account('inputVat', CODES.inputVat, 'Egyptian Tax Authority - VAT', 'مصلحة الضرائب المصرية – قيمة مضافة', 'asset');
  await account('vat', CODES.vatPayable, 'VAT Payable', 'ضرائب قيمة مضافة مستحقة', 'liability');
  await account('whtRec', CODES.withholdingTaxReceivable, 'Egyptian Tax Authority - Withholding & Addition', 'مصلحة الضرائب المصرية – ضرائب الخصم والإضافة', 'asset');
  await account('whtPay', CODES.withholdingTaxPayable, 'Withholding Taxes Payable', 'ضرائب خصم وإضافة', 'liability');
  await account('vatSettle', '31000011', 'VAT Settlement', null, 'liability');
  await account('whtAr', '11000020', 'Tax deducted at source', 'ضرائب الأرباح التجارية والصناعية', 'asset');
  await account('stamp', '31000013', 'Stamp Tax Payable', 'ضريبة دمغة', 'liability');
  await account('incomeTax', '70000001', 'Income Tax Expense', null, 'expense');
  await account('discount', '61000002', 'Discount allowed', 'خصم مسموح به', 'expense'); // "خصم" alone is not a tax

  c1 = await User.create({ name: 'Delta Builders', email: `c1-${Date.now()}@example.com`, role: 'user', type: 'online', taxInfo: { taxRegistrationNumber: '100-200-300' } });
  c2 = await User.create({ name: 'Nile Homes', email: `c2-${Date.now()}@example.com`, role: 'user', type: 'online' });
  v1 = await Vendor.create({ name: 'Steel Co', contact: { phone: `010${Date.now()}`.slice(0, 11) }, taxInfo: { taxRegistrationNumber: '555-666-777' } });
  p1 = id();
  await Project.collection.insertOne({ _id: p1, projectNumber: 'PRJ001', name: 'Villa', customer: c1._id, isDeleted: false });

  so1 = id();
  so2 = id();
  po1 = id();
  ex1 = id();
  await SalesOrder.collection.insertMany([
    { _id: so1, code: 'SO-0001', customer: c1._id, project: p1, orderSource: 'cashier', totalAmount: 100000, vatPercentage: 14, vatAmount: 14000, withholdingTaxPercentage: 1, withholdingTaxAmount: 1000 },
    { _id: so2, code: 'SO-0002', customer: c2._id, orderSource: 'cashier', totalAmount: 20000, vatPercentage: 14, vatAmount: 2800, withholdingTaxPercentage: 0, withholdingTaxAmount: 0 },
  ]);
  await PurchaseOrder.collection.insertOne({ _id: po1, code: 'PO-0001', vendorId: v1._id, totalAmount: 50000, vatPercentage: 14, vatAmount: 7000, withholdingTaxPercentage: 3, withholdingTaxAmount: 1500 });
  await Expense.collection.insertOne({ _id: ex1, vendor: v1._id, expenseAccount: A.rent._id, amount: 10000, vatPercentage: 5, vatAmount: 500, totalAmount: 10500, reference: 'INV-778' });

  const line = (acc, debit, credit, extra = {}) => ({ account: A[acc]._id, debit, credit, ...extra });
  const cust = c => ({ partyType: 'customer', partyNumber: c.customerNumber });
  const vend = { partyType: 'vendor', partyNumber: v1.vendorNumber };
  const je = async (key, date, lines, extra = {}) => {
    entryNo += 1;
    const doc = { entryNumber: entryNo, date: new Date(date), description: key, source: extra.accountingAction ? 'automatic' : 'manual', status: 'posted', lines, totalDebit: lines.reduce((s, l) => s + l.debit, 0), totalCredit: lines.reduce((s, l) => s + l.credit, 0), ...extra };
    const { insertedId } = await JournalEntry.collection.insertOne(doc);
    E[key] = { ...doc, _id: insertedId };
    return E[key];
  };

  // Before the period: VAT collected in cash, 3,000 (opening credit of VAT Payable).
  await je('E0', '2025-12-01T10:00:00Z', [line('bank', 3000, 0), line('vat', 0, 3000)]);
  // E1 SO-0001 recognized: 100,000 + VAT 14% 14,000 - withholding 1% 1,000. The party is only on AR.
  await je('E1', '2026-01-10T10:00:00Z', [line('ar', 113000, 0, { ...cust(c1), project: p1 }), line('whtRec', 1000, 0, { project: p1 }), line('revenue', 0, 100000, { project: p1 }), line('vat', 0, 14000, { project: p1 })], { accountingAction: 'PROJECT_REVENUE_RECOGNITION', sourceType: 'PROJECT', triggeredBySalesOrder: so1, project: p1 });
  // E2 PO-0001 received: 50,000 + input VAT 14% 7,000 - withholding 3% 1,500.
  await je('E2', '2026-02-05T10:00:00Z', [line('inventory', 50000, 0, vend), line('inputVat', 7000, 0, vend), line('suppliers', 0, 55500, vend), line('whtPay', 0, 1500, vend)], { accountingAction: 'PO_INVENTORY_RECEIPT', sourceType: 'PO', sourceId: po1 });
  // E3 expense 10,000 + input VAT 5% 500 (a second VAT rate).
  await je('E3', '2026-03-01T10:00:00Z', [line('rent', 10000, 0, vend), line('inputVat', 500, 0, vend), line('suppliers', 0, 10500, vend)], { accountingAction: 'EXPENSE_RECORDED', sourceType: 'EXPENSE', sourceId: ex1 });
  // E4 SO-0002 recognized (customer without a tax registration number), reversed by E5.
  await je('E4', '2026-03-15T10:00:00Z', [line('ar', 22800, 0, cust(c2)), line('revenue', 0, 20000), line('vat', 0, 2800)], { accountingAction: 'PROJECT_REVENUE_RECOGNITION', sourceType: 'PROJECT', triggeredBySalesOrder: so2, status: 'reversed' });
  await je('E5', '2026-03-20T10:00:00Z', [line('revenue', 20000, 0), line('vat', 2800, 0), line('ar', 0, 22800, cust(c2))], { reversalOfEntry: E.E4._id });
  await JournalEntry.collection.updateOne({ _id: E.E4._id }, { $set: { reversedByEntry: E.E5._id } });
  // E6 input VAT offset against output VAT; E7 VAT paid; E8 withholding paid to the Tax Authority.
  await je('E6', '2026-04-01T10:00:00Z', [line('vat', 7500, 0), line('inputVat', 0, 7500)]);
  await je('E7', '2026-04-10T10:00:00Z', [line('vat', 6500, 0), line('bank', 0, 6500)]);
  await je('E8', '2026-04-15T10:00:00Z', [line('whtPay', 1500, 0), line('bank', 0, 1500)]);
  // E9 manual adjustment; E10 a recognition tied to no Sales Order (party on the AR line).
  await je('E9', '2026-05-01T10:00:00Z', [line('rent', 200, 0), line('vatSettle', 0, 200)]);
  await je('E10', '2026-05-10T10:00:00Z', [line('ar', 11400, 0, cust(c1)), line('revenue', 0, 10000), line('vat', 0, 1400)], { accountingAction: 'PROJECT_REVENUE_RECOGNITION', sourceType: 'PROJECT' });
  // A draft never counts; a stamp-tax payment (a tax account to review); a line after the period.
  await je('E11', '2026-05-15T10:00:00Z', [line('bank', 999, 0), line('vat', 0, 999)], { status: 'draft' });
  await je('E12', '2026-05-20T10:00:00Z', [line('stamp', 300, 0), line('bank', 0, 300)]);
  await je('E13', '2026-07-05T10:00:00Z', [line('inputVat', 70, 0), line('bank', 0, 70)]);
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

const section = (result, key) => result.sections.find(s => s.key === key);
const summary = (result, key) => result.summary.find(s => s.key === key).value;
const rowsOf = (result, entryKey) => section(result, 'movements').rows.filter(r => r.entryNumber === E[entryKey].entryNumber);

test('Tax accounts are discovered from the Chart of Accounts and classified', async () => {
  const result = await R['tax-accounts-overview'](PERIOD);
  const rows = section(result, 'accounts').rows;
  const byCode = Object.fromEntries(rows.map(r => [r.code, r]));
  assert.deepEqual(rows.map(r => r.code), ['11000017', '11000019', '11000020', '31000010', '31000011', '31000012', '31000013', '70000001']);
  assert.equal(byCode['61000002'], undefined, '"خصم مسموح به" (discount) is not a tax account');
  assert.equal(byCode['11000017'].category, 'Value Added Tax');
  assert.equal(byCode['11000017'].role, 'Input VAT (recoverable)');
  assert.equal(byCode['31000010'].role, 'Output VAT (payable)');
  assert.equal(byCode['31000011'].category, 'Value Added Tax', 'found by its name');
  assert.equal(byCode['11000019'].role, 'Withholding tax receivable (deducted by customers)');
  assert.equal(byCode['31000012'].role, 'Withholding tax payable (deducted from suppliers)');
  assert.equal(byCode['11000020'].category, 'Commercial and Industrial Profit Tax (withholding)', 'found by its Arabic name');
  assert.match(byCode['31000013'].review, /does not say whether this is VAT or withholding/);
  assert.match(byCode['70000001'].review, /profit-or-loss account/);
  const covered = result.checks.find(c => /covered by a tax report/.test(c.label.en));
  assert.equal(covered.ok, false);
  assert.equal(covered.detail, '31000013, 70000001');
  assert.equal(summary(result, 'accounts'), 8);
  assert.equal(summary(result, 'review'), 2);
  // Overview balances: VAT Payable opening credit 3,000; debits 2,800 + 7,500 + 6,500; credits 14,000 + 2,800 + 1,400.
  assert.deepEqual(
    (({ openingDebit, openingCredit, periodDebit, periodCredit, closingDebit, closingCredit }) => ({ openingDebit, openingCredit, periodDebit, periodCredit, closingDebit, closingCredit }))(byCode['31000010']),
    { openingDebit: 0, openingCredit: 3000, periodDebit: 16800, periodCredit: 18200, closingDebit: 0, closingCredit: 4400 },
  );
  assert.equal(byCode['31000013'].periodDebit, 300, 'an account to review keeps its movements');
});

test('VAT - Credit: output VAT on documents, settlements and adjustments, with parties and rates', async () => {
  const result = await R['tax-vat-credit'](PERIOD);
  const movements = section(result, 'movements');
  // E1 14,000 + E4 2,800 + E6 7,500 + E9 200 + E10 1,400 (the draft E11 is excluded).
  assert.equal(summary(result, 'total'), 25900);
  assert.equal(summary(result, 'invoice'), 18200);
  assert.equal(summary(result, 'settlement'), 7500);
  assert.equal(summary(result, 'adjustment'), 200);
  assert.equal(summary(result, 'base'), 130000, 'documents 100,000 + 20,000 + 10,000, each once');
  assert.equal(movements.totals.taxAmount, 25900);
  assert.ok(result.checks.find(c => /equal the accounts/.test(c.label.en)).ok, 'detail lines reconcile to the ledger');

  const [e1] = rowsOf(result, 'E1');
  assert.equal(e1.accountCode, '31000010');
  assert.equal(e1.party, `${c1.customerNumber} - Delta Builders`, 'party from the Sales Order (not on the VAT line)');
  assert.equal(e1.partyType, 'Customer');
  assert.equal(e1.taxRegistrationNumber, '100-200-300');
  assert.equal(e1.documentNumber, 'SO-0001');
  assert.equal(e1.invoiceNumber, null, 'Sales Orders have no invoice number');
  assert.equal(e1.invoiceBase, 100000);
  assert.equal(e1.taxRate, 14);
  assert.equal(e1.effectiveRate, 14);
  assert.equal(e1.taxAmount, 14000);
  assert.equal(e1.projectNumber, 'PRJ001');
  assert.equal(e1.movementType, 'Tax on a document');
  assert.equal(e1.currency, 'EGP');

  const [e4] = rowsOf(result, 'E4');
  assert.equal(e4.taxRegistrationNumber, null);
  assert.match(e4.missing, /tax registration no\./);
  assert.equal(e4.status, `Reversed by entry ${E.E5.entryNumber}`);

  const [e10] = rowsOf(result, 'E10');
  assert.equal(e10.party, `${c1.customerNumber} - Delta Builders`, 'party from the Sub Account on the entry');
  assert.equal(e10.taxRate, null, 'no Sales Order - no document rate, never 0%');
  assert.equal(e10.effectiveRate, 14);
  assert.equal(e10.invoiceBase, 10000);
  assert.match(e10.missing, /source Sales Order/);

  const [e6] = rowsOf(result, 'E6');
  assert.equal(e6.accountCode, '11000017', 'a credit on input VAT is a settlement, not output VAT');
  assert.equal(e6.movementType, 'Settlement between tax accounts');
  assert.equal(e6.invoiceBase, null);
  assert.equal(e6.party, null);
  assert.equal(e6.missing, null, 'no party is expected on a settlement');

  const [e9] = rowsOf(result, 'E9');
  assert.equal(e9.accountCode, '31000011');
  assert.equal(e9.movementType, 'Manual entry / adjustment');
  assert.equal(e9.currency, null);

  const accounts = section(result, 'accounts');
  assert.deepEqual(accounts.rows.map(r => [r.code, r.closingDebit, r.closingCredit]), [['11000017', 0, 0], ['31000010', 0, 4400], ['31000011', 0, 200]]);
  assert.equal(accounts.totals.periodCredit, 25900);
});

test('VAT - Debit: input VAT at two rates, a reversal of output VAT, a payment and a settlement', async () => {
  const result = await R['tax-vat-debit'](PERIOD);
  // E2 7,000 + E3 500 + E5 2,800 + E6 7,500 + E7 6,500.
  assert.equal(summary(result, 'total'), 24300);
  assert.equal(summary(result, 'invoice'), 7500);
  assert.equal(summary(result, 'reversal'), 2800);
  assert.equal(summary(result, 'settlement'), 14000);
  assert.equal(summary(result, 'base'), 60000, 'purchase 50,000 + expense 10,000; the reversal is not a new document');
  assert.ok(result.checks.find(c => /equal the accounts/.test(c.label.en)).ok);
  assert.ok(result.checks.find(c => /amount × document rate/.test(c.label.en)).ok);

  const [e2] = rowsOf(result, 'E2');
  assert.equal(e2.party, `${v1.vendorNumber} - Steel Co`);
  assert.equal(e2.partyType, 'Supplier');
  assert.equal(e2.taxRegistrationNumber, '555-666-777');
  assert.equal(e2.documentNumber, 'PO-0001');
  assert.equal(e2.invoiceBase, 50000);
  assert.equal(e2.taxRate, 14);
  assert.equal(e2.role, 'Input VAT (recoverable)');

  const [e3] = rowsOf(result, 'E3');
  assert.equal(e3.invoiceNumber, 'INV-778');
  assert.equal(e3.documentType, 'Expense');
  assert.equal(e3.invoiceBase, 10000);
  assert.equal(e3.taxRate, 5);

  const [e5] = rowsOf(result, 'E5');
  assert.equal(e5.accountCode, '31000010');
  assert.equal(e5.movementType, 'Reversal');
  assert.equal(e5.status, `Reverses entry ${E.E4.entryNumber}`);
  assert.equal(e5.documentNumber, 'SO-0002', 'the reversed entry\'s document');
  assert.equal(e5.party, `${c2.customerNumber} - Nile Homes`);
  assert.equal(e5.invoiceBase, 20000);
  assert.equal(e5.taxRate, 14);

  assert.equal(rowsOf(result, 'E7')[0].movementType, 'Payment / refund');

  const rates = section(result, 'rates').rows.map(r => [r.accountCode, r.taxRate, r.documents, r.invoiceBase, r.taxAmount]);
  assert.deepEqual(rates.sort((a, b) => b[1] - a[1]), [['11000017', 14, 1, 50000, 7000], ['11000017', 5, 1, 10000, 500]]);
});

test('Commercial and industrial profit tax - debit and credit are kept apart from VAT', async () => {
  const debit = await R['tax-wht-debit'](PERIOD);
  // E1 withholding deducted by the customer 1,000 + E8 withholding paid to the Tax Authority 1,500.
  assert.equal(summary(debit, 'total'), 2500);
  assert.equal(summary(debit, 'invoice'), 1000);
  assert.equal(summary(debit, 'settlement'), 1500);
  const [e1] = rowsOf(debit, 'E1');
  assert.equal(e1.accountCode, '11000019');
  assert.equal(e1.taxRate, 1);
  assert.equal(e1.invoiceBase, 100000);
  assert.equal(e1.taxRegistrationNumber, '100-200-300');
  assert.equal(rowsOf(debit, 'E8')[0].movementType, 'Payment / refund');
  assert.deepEqual(section(debit, 'accounts').rows.map(r => r.code), ['11000019', '11000020', '31000012'], 'every withholding account, with or without movements');

  const credit = await R['tax-wht-credit'](PERIOD);
  assert.equal(summary(credit, 'total'), 1500);
  const [e2] = rowsOf(credit, 'E2');
  assert.equal(e2.accountCode, '31000012');
  assert.equal(e2.taxRate, 3);
  assert.equal(e2.invoiceBase, 50000);
  assert.equal(e2.party, `${v1.vendorNumber} - Steel Co`);
  assert.ok(section(credit, 'movements').rows.every(r => !['11000017', '31000010'].includes(r.accountCode)), 'no VAT in the withholding report');
});

test('Filters: customer, supplier, project, source, movement, reference and account', async () => {
  const total = async (key, filters) => summary(await R[key]({ ...PERIOD, ...filters }), 'total');
  assert.equal(await total('tax-vat-credit', { customer: String(c1._id) }), 15400, 'E1 14,000 + E10 1,400');
  assert.equal(await total('tax-vat-debit', { vendor: String(v1._id) }), 7500);
  assert.equal(await total('tax-vat-credit', { project: String(p1) }), 14000);
  assert.equal(await total('tax-vat-debit', { source: 'EXPENSE' }), 500);
  assert.equal(await total('tax-vat-debit', { movement: 'payment' }), 6500);
  assert.equal(await total('tax-vat-debit', { reference: 'inv-778' }), 500);
  assert.equal(await total('tax-vat-credit', { reference: '100-200' }), 15400, 'by tax registration number: both of Delta Builders\' lines');
  assert.equal(await total('tax-vat-credit', { reference: 'so-0001' }), 14000, 'by document number');
  assert.equal(await total('tax-vat-credit', { account: String(A.vatSettle._id) }), 200);
  const filtered = await R['tax-vat-debit']({ ...PERIOD, movement: 'payment' });
  assert.equal(filtered.checks.some(c => /equal the accounts/.test(c.label.en)), false, 'no ledger reconciliation claim on a filtered detail');
  await assert.rejects(() => R['tax-vat-credit']({ ...PERIOD, account: String(A.whtRec._id) }), /not a Value Added Tax account/);
  await assert.rejects(() => R['tax-vat-credit']({ ...PERIOD, movement: 'bogus' }), /Invalid movement type/);
  await assert.rejects(() => R['tax-vat-credit']({ ...PERIOD, customer: 'x' }), /Invalid customer/);
  await assert.rejects(() => R['tax-vat-credit']({ from: '2026-07-01', to: '2026-06-30' }), /start date must be on or before/);
});

test('Historical and empty periods; the ledger is never changed', async () => {
  const counts = async () => Promise.all(['journalentries', 'chartofaccounts', 'salesorders', 'purchaseorders', 'expenses', 'users', 'vendors'].map(c => mongoose.connection.collection(c).countDocuments()));
  const beforeCounts = await counts();
  const beforeEntry = await JournalEntry.collection.findOne({ _id: E.E4._id });

  const last = await R['tax-vat-credit']({ from: '2025-01-01', to: '2025-12-31' });
  assert.equal(summary(last, 'total'), 3000);
  assert.equal(rowsOf(last, 'E0')[0].movementType, 'Payment / refund');

  const empty = await R['tax-wht-credit']({ from: '2027-01-01', to: '2027-03-31' });
  assert.equal(section(empty, 'movements').rows.length, 0);
  assert.equal(summary(empty, 'total'), 0);
  assert.equal(section(empty, 'accounts').totals.closingCredit, 0, 'withholding payable was fully paid by E8');
  assert.ok(empty.checks.every(c => c.ok));

  for (const key of ['tax-wht-debit', 'tax-wht-credit', 'tax-vat-debit', 'tax-vat-credit', 'tax-accounts-overview']) await runReport(key, PERIOD);
  assert.deepEqual(await counts(), beforeCounts);
  assert.deepEqual(await JournalEntry.collection.findOne({ _id: E.E4._id }), beforeEntry);
});

test('A posted tax that disagrees with the document rate is flagged, not corrected', async () => {
  const po2 = id();
  await PurchaseOrder.collection.insertOne({ _id: po2, code: 'PO-0002', vendorId: v1._id, totalAmount: 5000, vatPercentage: 14 });
  const { insertedId } = await JournalEntry.collection.insertOne({
    entryNumber: 799999,
    date: new Date('2026-06-01T10:00:00Z'),
    status: 'posted',
    source: 'automatic',
    accountingAction: 'PO_INVENTORY_RECEIPT',
    sourceType: 'PO',
    sourceId: po2,
    lines: [{ account: A.inventory._id, debit: 5000, credit: 0 }, { account: A.inputVat._id, debit: 500, credit: 0 }, { account: A.suppliers._id, debit: 0, credit: 5500 }],
  });
  try {
    const result = await R['tax-vat-debit'](PERIOD);
    const rateCheck = result.checks.find(c => /amount × document rate/.test(c.label.en));
    assert.equal(rateCheck.ok, false);
    assert.equal(rateCheck.detail, '1 line(s)');
    const row = section(result, 'movements').rows.find(r => r.documentNumber === 'PO-0002');
    assert.equal(row.taxAmount, 500, 'the posted amount is shown as posted');
    assert.equal(row.taxRate, 14);
    assert.equal(row.effectiveRate, 10);
    assert.match(row.missing, /differs from amount × document rate \(700\)/);
  } finally {
    await JournalEntry.collection.deleteOne({ _id: insertedId });
    await PurchaseOrder.collection.deleteOne({ _id: po2 });
  }
});

test('Excel export carries every row in Arabic (RTL) and English; the tax account list route is not a report key', async () => {
  const result = await runReport('tax-vat-credit', PERIOD);
  const ar = await buildWorkbook(result, 'ar');
  const sheet = ar.worksheets[0];
  assert.equal(sheet.views[0].rightToLeft, true);
  assert.equal(sheet.getRow(1).values[1], 'ضرائب القيمة المضافة - دائن');
  let headerIndex = 0;
  sheet.eachRow((row, index) => {
    if (row.values.includes('رقم التسجيل الضريبي')) headerIndex = index;
  });
  assert.ok(headerIndex > 0, 'Arabic column headers');
  assert.equal(sheet.rowCount, headerIndex + 5 + 1, 'all 5 movement lines + the totals row');
  const en = await buildWorkbook(result, 'en');
  assert.equal(en.worksheets[0].views[0].rightToLeft, false);
  let found = false;
  en.worksheets[0].eachRow(row => {
    if (row.values.includes('100-200-300')) found = true;
  });
  assert.ok(found, 'tax registration numbers are exported');

  const router = require('../../routes/accountingReportsRoute');
  const authController = require('../../controller/user/authController');
  assert.equal(router.stack[0].handle, authController.protect);
  const paths = router.stack.filter(l => l.route).map(l => l.route.path);
  assert.ok(paths.indexOf('/tax-accounts') < paths.indexOf('/:key'), 'registered before /:key');
  const { taxAccountOptions } = require('../../services/reports/taxReports');
  const options = await taxAccountOptions();
  assert.deepEqual(options.find(o => o.code === '31000010').reports, ['tax-vat-debit', 'tax-vat-credit']);
  assert.deepEqual(options.find(o => o.code === '31000013').reports, []);
});
