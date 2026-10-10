const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Accounting enhancements, end to end against one explicit ledger: closed accounting periods,
// journal entry ordering / line rules, the general ledger's treatment of reversals, cash flow
// classification (fixed asset payments = investing, a finance-classified vendor = financing),
// expense categories, fixed asset acquisitions on the vendor page, PUC transfers and the project
// PUC balance / revenue detail, depreciation in the reports, and the guided tour status.
// Every expected figure is worked out by hand in the comments.

const DB_URI = process.env.TEST_DB_URI_ENHANCEMENTS || 'mongodb://127.0.0.1:27017/reversia_test_accounting_enhancements';
const { AutomaticJournalAccountCodes: C } = require('../../utils/accountingConstants');

let JournalEntry, ChartOfAccount, Vendor, User, Warehouse, Payment, Project, Product, PurchaseOrder, FixedAsset, Expense, AccountingPeriod, PucTransfer;
let createFixedAsset, runDepreciation, recordFixedAssetPayment, vendorFixedAssetAcquisitions;
let createExpense, addExpensePayment, updateExpense;
let createCategory, updateCategory, deleteCategory;
let closePeriod, reopenPeriod;
let recordPucTransfer, projectQuantity;
let getTrialBalance, getAccountBalance;
let R; // accounting reports by key
let getJournalEntries, reverseJournalEntry, createJournalEntry;
let transactionsSupported = true;
const A = {};
let vendor, financeVendor, customer, warehouse, p1, p2, product, admin;
let entrySeq = 900000;
let keySeq = 0;
const id = () => new mongoose.Types.ObjectId();
const key = () => `test-key-${++keySeq}-${Date.now()}`;

async function inTx(work) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } finally {
    session.endSession();
  }
}

// Runs an express handler with a fake req/res; resolves { status, body } or rejects with the error.
function callHandler(handler, req) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        resolve({ status: this.statusCode, body });
      },
      send() {
        resolve({ status: this.statusCode });
      },
    };
    Promise.resolve(handler({ headers: {}, query: {}, body: {}, params: {}, user: admin, ...req }, res, err => (err ? reject(err) : resolve({ status: res.statusCode })))).catch(reject);
  });
}

// A posted entry written straight to the collection (bypassing the model): test fixtures only.
async function rawEntry(date, lines, extra = {}) {
  entrySeq += 1;
  const doc = { entryNumber: entrySeq, date: new Date(date), description: 'Fixture', source: 'automatic', status: 'posted', lines: lines.map(l => ({ description: 'Fixture', ...l })), totalDebit: lines.reduce((s, l) => s + (l.debit || 0), 0), totalCredit: lines.reduce((s, l) => s + (l.credit || 0), 0), ...extra };
  const { insertedId } = await JournalEntry.collection.insertOne(doc);
  return { ...doc, _id: insertedId };
}
const ln = (acc, debit, credit, extra = {}) => ({ account: A[acc]._id, debit, credit, ...extra });

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  Warehouse = require('../../models/inventory/warehouseModel');
  Payment = require('../../models/vendor/paymentModel');
  JournalEntry = require('../../models/accounting/journalEntryModel');
  ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
  Vendor = require('../../models/vendor/vendor');
  User = require('../../models/userModel');
  Project = require('../../models/project/projectModel');
  Product = require('../../models/inventory/productModel');
  PurchaseOrder = require('../../models/vendor/purchaseOrder');
  FixedAsset = require('../../models/fixedAssets');
  Expense = require('../../models/expense/expenseModel');
  AccountingPeriod = require('../../models/accounting/accountingPeriodModel');
  PucTransfer = require('../../models/inventory/pucTransferModel');
  require('../../models/equity/shareholderModel');
  ({ createFixedAsset, runDepreciation } = require('../../services/fixedAssets/fixedAssetService'));
  ({ recordFixedAssetPayment, vendorFixedAssetAcquisitions } = require('../../services/fixedAssets/fixedAssetPaymentService'));
  ({ createExpense, addExpensePayment, updateExpense } = require('../../services/expenses/expenseService'));
  ({ createCategory, updateCategory, deleteCategory } = require('../../services/expenses/expenseCategoryService'));
  ({ closePeriod, reopenPeriod } = require('../../services/accounting/accountingPeriodService'));
  ({ recordPucTransfer, projectQuantity } = require('../../services/inventory/pucTransferService'));
  ({ getTrialBalance, getAccountBalance } = require('../../services/accounting/generalLedgerService'));
  ({ getJournalEntries, reverseJournalEntry, createJournalEntry } = require('../../controller/accounting/journalEntryController'));
  const { REPORTS_BY_KEY } = require('../../services/reports/reportRegistry');
  R = Object.fromEntries([...REPORTS_BY_KEY].map(([k, r]) => [k, r.run]));
  await Promise.all([JournalEntry.init(), FixedAsset.init(), PucTransfer.init(), AccountingPeriod.init(), Vendor.init(), User.init()]);

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

  const account = (k, code, name, type, parentGroupNameEn = null, nameAr = null) => ChartOfAccount.create({ code, name, type, parentGroupNameEn, nameAr }).then(a => (A[k] = a));
  await account('bank', '11000001', 'Bank Misr', 'asset', 'Cash & Cash Equivalents');
  await account('ar', C.accountsReceivableProjects, 'Accounts Receivable (Projects)', 'asset');
  await account('suppliers', C.suppliers, 'Suppliers', 'liability');
  await account('inventory', C.materialsInventory, 'Materials Inventory', 'asset');
  await account('wip', C.wipRawMaterials, 'PUC - Raw Materials', 'asset', null, 'مشروعات تحت التنفيذ - مواد خام');
  await account('inputVat', C.inputVat, 'Input VAT', 'asset');
  await account('vat', C.vatPayable, 'VAT Payable', 'liability');
  await account('revenue', C.revenue, 'Revenue', 'revenue');
  await account('vehicles', '12000001', 'Vehicles', 'asset', 'Property, Plant & Equipment');
  await account('accDep', '12000099', 'Accumulated Depreciation – Fixed Assets', 'asset', 'Property, Plant & Equipment');
  await account('depExp', '62000001', 'Depreciation & Amortization', 'expense', 'Operating Expenses');
  await account('rent', '61000001', 'Office Rent', 'expense');
  await account('interest', '61000009', 'Bank Interest & Finance Costs', 'expense');
  await account('capital', '20000001', 'Share Capital', 'equity');

  admin = await User.create({ name: 'Admin', email: `admin-${Date.now()}@example.com`, role: 'admin', type: 'online' });
  customer = await User.create({ name: 'Delta Builders', email: `c-${Date.now()}@example.com`, role: 'user', type: 'online' });
  vendor = await Vendor.create({ name: 'Auto Dealer', contact: { phone: `010${Date.now()}`.slice(0, 11) } });
  financeVendor = await Vendor.create({ name: 'Supplier - Finance Activities', contact: { phone: `011${Date.now()}`.slice(0, 11) }, cashFlowActivity: 'financing' });
  warehouse = await Warehouse.create({ name: 'Head Office', location: 'Cairo', balance: 1000000 });
  p1 = { _id: id(), projectNumber: 'PRJ001' };
  p2 = { _id: id(), projectNumber: 'PRJ002' };
  await Project.collection.insertMany([
    { _id: p1._id, projectNumber: 'PRJ001', name: 'Villa', customer: customer._id, status: 'active', isDeleted: false },
    { _id: p2._id, projectNumber: 'PRJ002', name: 'Factory', status: 'active', isDeleted: false },
  ]);
  product = { _id: id() };
  await Product.collection.insertOne({ _id: product._id, type: 'product', title: { en: 'Steel Bar', ar: 'حديد' }, cost: 100, price: 150, stock: [{ warehouse: warehouse._id, quantity: 50 }] });
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

const PERIOD_MSG = /Accounting period is closed\. Please contact the administrator to reopen it\./;
const VEHICLE = (overrides = {}) => ({
  name: 'Delivery Truck',
  vendor: vendor._id,
  assetAccountId: A.vehicles._id,
  accumulatedAccountId: A.accDep._id,
  depreciationAccountId: A.depExp._id,
  acquisitionDate: new Date('2026-01-15'),
  price: 100000,
  usefulLifeMonths: 50,
  vatPercentage: 0,
  ...overrides,
});
const manualEntry = (date, lines, extra = {}) =>
  callHandler(createJournalEntry, { body: { date, description: 'Manual entry', project: String(p1._id), lines, ...extra } });

// ============================================================ fixed assets, cash flow, vendor page
test('fixed asset acquisition: numbered, on the vendor page, and its payments are investing cash flows', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  const truck = await inTx(s => createFixedAsset(VEHICLE(), admin._id, s)); // 100,000 owed, no VAT
  const van = await inTx(s => createFixedAsset(VEHICLE({ name: 'Van', price: 20000 }), admin._id, s));
  assert.equal(truck.assetNumber, 1);
  assert.equal(van.assetNumber, 2);
  assert.equal(truck.assetCode, 'FA-0001');

  // 40,000 paid in February, 10,000 in March; the van is unpaid.
  await inTx(s => recordFixedAssetPayment(truck._id, { amount: 40000, paymentAccount: A.bank._id, warehouseId: warehouse._id, date: '2026-02-01', reference: 'CHQ-1', requestKey: key() }, admin._id, s));
  await inTx(s => recordFixedAssetPayment(truck._id, { amount: 10000, paymentAccount: A.bank._id, warehouseId: warehouse._id, date: '2026-03-01', requestKey: key() }, admin._id, s));

  const rows = await vendorFixedAssetAcquisitions(vendor._id);
  const truckRow = rows.find(r => r.name === 'Delivery Truck');
  assert.equal(rows.length, 2);
  assert.equal(truckRow.assetNumber, 'FA-0001');
  assert.equal(truckRow.acquisitionAmount, 100000);
  assert.equal(truckRow.totalPaid, 50000);
  assert.equal(truckRow.outstanding, 50000);
  assert.equal(truckRow.status, 'partially_paid');
  assert.equal(truckRow.payments.length, 2);
  assert.ok(truckRow.acquisitionJournalEntry.entryNumber > 0);
  assert.equal(rows.find(r => r.name === 'Van').status, 'unpaid');

  // Cash flow Q1: only the 50,000 actually paid, under investing - not the unpaid 70,000 balance.
  const cf = await R['cash-flow']({ from: '2026-01-01', to: '2026-03-31' });
  const value = k => cf.summary.find(x => x.key === k).value;
  assert.equal(value('investing'), -50000);
  assert.equal(value('operating'), 0);
  const classified = cf.sections.find(x => x.key === 'classified');
  assert.equal(classified.rows.length, 2);
  assert.ok(classified.rows.every(r => r.activity === 'Investing Activities' && r.rule === 'Transaction type'));
  assert.ok(cf.checks.every(c => c.ok));

  // Reversing the March payment: it cancels within investing (net 40,000 out) and the asset is owed 60,000 again.
  const marchPayment = await JournalEntry.findOne({ accountingAction: 'FIXED_ASSET_PAYMENT_RECORDED', date: new Date('2026-03-01') });
  await callHandler(reverseJournalEntry, { params: { id: String(marchPayment._id) }, body: { reversalDate: new Date('2026-03-20') } });
  const cf2 = await R['cash-flow']({ from: '2026-01-01', to: '2026-03-31' });
  assert.equal(cf2.summary.find(x => x.key === 'investing').value, -40000);
  assert.equal((await vendorFixedAssetAcquisitions(vendor._id)).find(r => r.name === 'Delivery Truck').outstanding, 60000);
});

test('depreciation reaches the trial balance, profit or loss, financial position and the general ledger - once, from its entries', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  // Truck 100,000 / 50 months = 2,000 a month; van 20,000 / 50 = 400. January: 2,400.
  const run = await inTx(s => runDepreciation({ period: '2026-01', userId: admin._id }, s));
  assert.equal(run.totalAmount, 2400);
  const tb = await R['trial-balance']({ from: '2026-01-01', to: '2026-01-31' });
  const rows = tb.sections.flatMap(s => s.rows);
  assert.equal(rows.find(r => r.code === '62000001').periodDebit, 2400);
  assert.equal(rows.find(r => r.code === '12000099').periodCredit, 2400);
  const pl = await R['profit-loss']({ from: '2026-01-01', to: '2026-01-31' });
  assert.equal(pl.summary.find(s => s.key === 'netProfit').value, -2400);
  // Cost stays separate from accumulated depreciation; net book value = 120,000 - 2,400.
  const pos = await R['financial-position']({ asOf: '2026-01-31' });
  const posRows = pos.sections.flatMap(s => s.rows);
  assert.equal(posRows.find(r => r.code === '12000001').amount, 120000);
  assert.equal(posRows.find(r => r.code === '12000099').amount, -2400);
  // The general ledger service (Chart of Accounts balances / dashboard) shows the same figures.
  const gl = await getTrialBalance();
  assert.equal(gl.find(r => r.account.code === '62000001').debit, 2400);
  // Depreciation moves no cash.
  const cf = await R['cash-flow']({ from: '2026-01-01', to: '2026-01-31' });
  assert.equal(cf.summary.find(x => x.key === 'netChange').value, 0);
});

test('the general ledger counts a reversed entry and its reversal - together they net to zero', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  // The March payment was reversed above: Dr Suppliers 10,000 / Cr Bank, then the mirror.
  const balance = await getAccountBalance(A.bank._id);
  // Bank: -40,000 (February) - 10,000 (March) + 10,000 (reversal) = -40,000.
  assert.equal(balance.balance, -40000);
  const gl = await getTrialBalance();
  assert.equal(gl.find(r => r.account.code === '11000001').balance, -40000);
  assert.equal(Math.round(gl.reduce((s, r) => s + r.balance, 0) * 100) / 100, 0, 'the whole ledger balances');
});

test('finance costs paid to a financing-classified vendor are financing; ordinary expenses stay operating; unpaid is not cash', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  const interest = await inTx(s => createExpense({ vendor: financeVendor._id, expenseAccount: A.interest._id, amount: 5000, date: '2026-04-05' }, admin._id, s));
  const rent = await inTx(s => createExpense({ vendor: vendor._id, expenseAccount: A.rent._id, amount: 3000, date: '2026-04-06' }, admin._id, s));
  await inTx(s => createExpense({ vendor: financeVendor._id, expenseAccount: A.interest._id, amount: 999, date: '2026-04-07' }, admin._id, s)); // unpaid
  await inTx(s => addExpensePayment(interest._id, { amount: 2000, paymentAccount: A.bank._id, warehouseId: warehouse._id, date: '2026-04-10' }, admin._id, s)); // partial
  await inTx(s => addExpensePayment(rent._id, { amount: 3000, paymentAccount: A.bank._id, warehouseId: warehouse._id, date: '2026-04-11' }, admin._id, s));

  const cf = await R['cash-flow']({ from: '2026-04-01', to: '2026-04-30' });
  const value = k => cf.summary.find(x => x.key === k).value;
  assert.equal(value('financing'), -2000, 'only the 2,000 actually paid for finance costs');
  assert.equal(value('operating'), -3000, 'the ordinary rent payment');
  assert.equal(value('investing'), 0);
  assert.equal(cf.sections.find(x => x.key === 'classified').rows[0].rule, 'Vendor cash flow classification');

  // The analytics dashboard uses the same classification.
  const { financialDashboard } = require('../../services/analytics/financialDashboardService');
  const dash = await financialDashboard({ from: '2026-04-01', to: '2026-04-30' });
  assert.equal(dash.totals.financing, -2000);
  assert.equal(dash.totals.operating, -3000);
});

// ============================================================ journal entries
test('journal entries are listed by entry number, ascending, across pages - never by date or as text', async () => {
  // Entry numbers 9 and 10 dated so that a date order would differ; text order would put 10 before 9.
  await JournalEntry.collection.insertMany([
    { entryNumber: 10, date: new Date('2026-01-01'), status: 'posted', source: 'manual', lines: [], totalDebit: 0, totalCredit: 0 },
    { entryNumber: 9, date: new Date('2026-12-01'), status: 'posted', source: 'manual', lines: [], totalDebit: 0, totalCredit: 0 },
  ]);
  const page1 = await callHandler(getJournalEntries, { query: { limit: '2', page: '1' } });
  const page2 = await callHandler(getJournalEntries, { query: { limit: '2', page: '2' } });
  assert.deepEqual(page1.body.data.map(e => e.entryNumber), [9, 10]);
  const all = await callHandler(getJournalEntries, { query: { limit: '1000' } });
  const numbers = all.body.data.map(e => e.entryNumber);
  assert.deepEqual(numbers, [...numbers].sort((a, b) => a - b));
  assert.ok(page2.body.data[0].entryNumber > 10);
  await JournalEntry.collection.deleteMany({ entryNumber: { $in: [9, 10] } });
});

test('manual journal lines need a description and the right Sub Account for control accounts', async () => {
  const good = { account: String(A.bank._id), debit: 100, credit: 0, description: 'Cash in' };
  // Accounts Receivable requires a customer sub-account.
  await assert.rejects(() => manualEntry('2026-05-02', [good, { account: String(A.ar._id), debit: 0, credit: 100, description: 'AR' }]), /requires a customer sub-account/);
  await assert.rejects(() => manualEntry('2026-05-02', [good, { account: String(A.ar._id), debit: 0, credit: 100, description: 'AR', partyType: 'vendor', partyNumber: vendor.vendorNumber }]), /requires a customer sub-account, not a vendor/);
  await assert.rejects(() => manualEntry('2026-05-02', [good, { account: String(A.ar._id), debit: 0, credit: 100, description: 'AR', partyType: 'customer', partyNumber: 999999 }]), /customer sub-account number 999999 does not exist/);
  await assert.rejects(() => manualEntry('2026-05-02', [good, { account: String(A.rent._id), debit: 0, credit: 100, description: 'x', partyType: 'shareholder', partyNumber: 1 }]), /shareholder sub-account can only be used on an equity account/);
  await assert.rejects(() => manualEntry('2026-05-02', [good, { account: String(A.suppliers._id), debit: 0, credit: 100, description: '  ' }]), /description is required/);
  const ok = await manualEntry('2026-05-02', [good, { account: String(A.ar._id), debit: 0, credit: 100, description: 'Customer receipt', partyType: 'customer', partyNumber: customer.customerNumber }]);
  assert.equal(ok.status, 201);
  assert.equal(ok.body.data.lines[1].partyNumber, customer.customerNumber);
  assert.ok(ok.body.data.lines.every(l => String(l.project) === String(p1._id)), 'every line carries the project');
  // A draft must still balance.
  await assert.rejects(() => manualEntry('2026-05-02', [good, { account: String(A.rent._id), debit: 0, credit: 90, description: 'x' }]), /not balanced/);
});

// ============================================================ closed periods
test('a closed accounting period rejects every accounting write dated in it - and nothing is left behind', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  // A draft dated in June, created before June is closed.
  const draft = await manualEntry('2026-06-10', [
    { account: String(A.bank._id), debit: 50, credit: 0, description: 'Cash' },
    { account: String(A.rent._id), debit: 0, credit: 50, description: 'Refund' },
  ]);
  const posted = await JournalEntry.findOne({ accountingAction: 'FIXED_ASSET_PAYMENT_RECORDED', date: new Date('2026-02-01') });
  await closePeriod('2026-06', admin._id, 'June closed');
  await closePeriod('2026-02', admin._id);
  await assert.rejects(() => closePeriod('2026-06', admin._id), /already closed/);
  await assert.rejects(() => closePeriod('2099-01', admin._id), /future accounting period/);

  const counts = async () => Promise.all(['journalentries', 'payments', 'expenses', 'fixedassets', 'puctransfers'].map(c => mongoose.connection.collection(c).countDocuments()));
  const before = await counts();
  const stockBefore = (await Product.collection.findOne({ _id: product._id })).stock[0].quantity;

  // Manual entry, edit and posting into a closed month.
  await assert.rejects(() => manualEntry('2026-06-15', [{ account: String(A.bank._id), debit: 1, credit: 0, description: 'a' }, { account: String(A.rent._id), debit: 0, credit: 1, description: 'b' }]), PERIOD_MSG);
  const entry = await JournalEntry.findById(draft.body.data._id);
  await assert.rejects(() => entry.save().then(() => JournalEntry.findById(entry._id)).then(e => ((e.status = 'posted'), e.save())), PERIOD_MSG);
  const moved = await JournalEntry.findById(entry._id);
  moved.date = new Date('2026-07-01'); // moving it out of the closed month is also a change to it
  await assert.rejects(() => moved.save(), PERIOD_MSG);
  // Automatic entries: an expense, a fixed asset payment, a depreciation run, a PUC transfer.
  await assert.rejects(() => inTx(s => createExpense({ vendor: vendor._id, expenseAccount: A.rent._id, amount: 10, date: '2026-06-03' }, admin._id, s)), PERIOD_MSG);
  const truck = await FixedAsset.findOne({ name: 'Delivery Truck' });
  await assert.rejects(() => inTx(s => recordFixedAssetPayment(truck._id, { amount: 10, paymentAccount: A.bank._id, warehouseId: warehouse._id, date: '2026-06-04', requestKey: key() }, admin._id, s)), PERIOD_MSG);
  await assert.rejects(() => inTx(s => runDepreciation({ period: '2026-06', userId: admin._id }, s)), PERIOD_MSG);
  await assert.rejects(() => inTx(s => recordPucTransfer(product._id, { quantity: 1, project: p1._id, sourceType: 'warehouse', warehouse: warehouse._id, date: '2026-06-05', requestKey: key() }, admin._id, s)), PERIOD_MSG);
  // A reversal dated in a closed month is refused; reversing a closed month's entry into an open month is allowed.
  await assert.rejects(() => callHandler(reverseJournalEntry, { params: { id: String(posted._id) }, body: { reversalDate: new Date('2026-06-30') } }), PERIOD_MSG);

  assert.deepEqual(await counts(), before, 'no partial record of any rejected operation');
  assert.equal((await Product.collection.findOne({ _id: product._id })).stock[0].quantity, stockBefore, 'stock untouched');
  const error = await manualEntry('2026-06-15', [{ account: String(A.bank._id), debit: 1, credit: 0, description: 'a' }, { account: String(A.rent._id), debit: 0, credit: 1, description: 'b' }]).catch(e => e);
  assert.equal(error.statusCode, 400);
  assert.deepEqual(error.details, { code: 'ACCOUNTING_PERIOD_CLOSED', period: '2026-06', date: '2026-06-15' });

  const reversed = await callHandler(reverseJournalEntry, { params: { id: String(posted._id) }, body: { reversalDate: new Date('2026-08-01') } });
  assert.equal(reversed.status, 201, 'the closed February is not changed by a reversal dated in August');

  // Reopened, June accepts entries again; the history is kept.
  const reopened = await reopenPeriod('2026-06', admin._id, 'Adjustment needed');
  assert.equal(reopened.status, 'open');
  assert.deepEqual(reopened.history.map(h => h.action), ['closed', 'reopened']);
  const fresh = await JournalEntry.findById(entry._id);
  fresh.status = 'posted';
  await fresh.save();
  await assert.rejects(() => reopenPeriod('2026-06', admin._id), /is not closed/);
  await reopenPeriod('2026-02', admin._id);
});

// ============================================================ expense categories
test('expense categories: unique names, inactive ones cannot be chosen, used ones cannot be deleted, and the report adds up', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  const travel = await createCategory({ name: 'Travel', nameAr: 'سفر' }, admin._id);
  const office = await createCategory({ name: 'Office' }, admin._id);
  await assert.rejects(() => createCategory({ name: 'travel' }, admin._id), /already exists/);

  // Travel: 1,000 + 14% VAT, paid 500; Office: 2,000, unpaid.
  const e1 = await inTx(s => createExpense({ vendor: vendor._id, expenseAccount: A.rent._id, amount: 1000, vatPercentage: 14, date: '2026-09-01', category: travel._id }, admin._id, s));
  await inTx(s => addExpensePayment(e1._id, { amount: 500, paymentAccount: A.bank._id, warehouseId: warehouse._id, date: '2026-09-02' }, admin._id, s));
  await inTx(s => createExpense({ vendor: vendor._id, expenseAccount: A.rent._id, amount: 2000, date: '2026-09-03', category: office._id }, admin._id, s));
  await inTx(s => createExpense({ vendor: vendor._id, expenseAccount: A.rent._id, amount: 300, date: '2026-09-04' }, admin._id, s)); // no category

  await updateCategory(office._id, { isActive: false }, admin._id);
  await assert.rejects(() => inTx(s => createExpense({ vendor: vendor._id, expenseAccount: A.rent._id, amount: 1, date: '2026-09-05', category: office._id }, admin._id, s)), /inactive/);
  const officeExpense = await Expense.findOne({ category: office._id });
  await inTx(s => updateExpense(officeExpense._id, { notes: 'kept', category: office._id }, s)); // an inactive category stays on its expenses
  await assert.rejects(() => deleteCategory(travel._id), /used by 1 expense/);
  const unused = await createCategory({ name: 'Unused' }, admin._id);
  await deleteCategory(unused._id);

  const report = await R['expenses-by-category']({ from: '2026-09-01', to: '2026-09-30' });
  const byName = Object.fromEntries(report.sections[0].rows.map(r => [r.category, r]));
  assert.deepEqual([byName.Travel.amount, byName.Travel.vat, byName.Travel.total, byName.Travel.paid, byName.Travel.outstanding], [1000, 140, 1140, 500, 640]);
  assert.deepEqual([byName.Office.amount, byName.Office.outstanding, byName.Office.active], [2000, 2000, 'Inactive']);
  assert.equal(byName['No category'].amount, 300);
  assert.equal(report.summary.find(s => s.key === 'amount').value, 3300);
  assert.ok(report.checks.every(c => c.ok), 'category totals equal the posted expense entries');
  const onlyTravel = await R['expenses-by-category']({ from: '2026-09-01', to: '2026-09-30', category: String(travel._id) });
  assert.equal(onlyTravel.sections[1].rows.length, 1);

  // The expense list filters by category and date range (count included).
  const { getExpenses } = require('../../controller/expenseController');
  const list = await callHandler(getExpenses, { query: { category: String(travel._id), from: '2026-09-01', to: '2026-09-30' } });
  assert.equal(list.body.data.length, 1);
  assert.equal(list.body.paginationResult.numberOfPages ?? 1, 1);
  const none = await callHandler(getExpenses, { query: { category: 'none', from: '2026-09-01', to: '2026-09-30' } });
  assert.equal(none.body.data.length, 1);
  await assert.rejects(() => callHandler(getExpenses, { query: { category: 'not-an-id' } }), /Invalid expense category id/);
});

// ============================================================ PUC transfers and project PUC
test('PUC transfer from warehouse stock: stock down, Materials Inventory to project PUC, idempotent, never more than held', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  // Opening materials in inventory not yet in any project: 2,000 (20 units at 100).
  await rawEntry('2026-01-02', [ln('inventory', 2000, 0), ln('suppliers', 0, 2000)]);
  const k = key();
  const first = await inTx(s => recordPucTransfer(product._id, { quantity: 5, project: p1._id, sourceType: 'warehouse', warehouse: warehouse._id, date: '2026-09-10', requestKey: k }, admin._id, s));
  const again = await inTx(s => recordPucTransfer(product._id, { quantity: 5, project: p1._id, sourceType: 'warehouse', warehouse: warehouse._id, date: '2026-09-10', requestKey: k }, admin._id, s));
  assert.equal(again.duplicate, true);
  assert.equal(String(again.transfer._id), String(first.transfer._id));
  assert.equal((await Product.collection.findOne({ _id: product._id })).stock[0].quantity, 45, '50 - 5, once');
  const je = await JournalEntry.findById(first.transfer.journalEntry).lean();
  assert.equal(je.accountingAction, 'PUC_TRANSFER');
  assert.deepEqual(je.lines.map(l => [String(l.account._id || l.account), l.debit, l.credit, String(l.project._id || l.project)]), [
    [String(A.wip._id), 500, 0, String(p1._id)],
    [String(A.inventory._id), 0, 500, String(p1._id)],
  ]);

  // 45 in stock but only 1,500 of cost left in Materials Inventory: 16 units (1,600) is refused.
  await assert.rejects(() => inTx(s => recordPucTransfer(product._id, { quantity: 16, project: p1._id, sourceType: 'warehouse', warehouse: warehouse._id, requestKey: key() }, admin._id, s)), /Only 1500 of materials cost/);
  await assert.rejects(() => inTx(s => recordPucTransfer(product._id, { quantity: 0, project: p1._id, sourceType: 'warehouse', warehouse: warehouse._id }, admin._id, s)), /positive number/);
  await assert.rejects(() => inTx(s => recordPucTransfer(product._id, { quantity: -2, project: p1._id, sourceType: 'warehouse', warehouse: warehouse._id }, admin._id, s)), /positive number/);
  await assert.rejects(() => inTx(s => recordPucTransfer(product._id, { quantity: 1, project: id(), sourceType: 'warehouse', warehouse: warehouse._id }, admin._id, s)), /project does not exist/);

  // Two simultaneous requests for 10 units each when only 15 units' cost (1,500) is held: one goes through.
  const outcomes = await Promise.allSettled([
    inTx(s => recordPucTransfer(product._id, { quantity: 10, project: p1._id, sourceType: 'warehouse', warehouse: warehouse._id, date: '2026-09-11', requestKey: key() }, admin._id, s)),
    inTx(s => recordPucTransfer(product._id, { quantity: 10, project: p2._id, sourceType: 'warehouse', warehouse: warehouse._id, date: '2026-09-11', requestKey: key() }, admin._id, s)),
  ]);
  assert.equal(outcomes.filter(o => o.status === 'fulfilled').length, 1, outcomes.map(o => o.reason?.message).join(' | '));
  assert.equal((await Product.collection.findOne({ _id: product._id })).stock[0].quantity, 35);
});

test('PUC transfer between projects: limited to what the source project received; company PUC unchanged; project report reconciles', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  // PRJ002 bought 8 units on its own Purchase Order (already in its PUC: 800).
  await PurchaseOrder.collection.insertOne({ _id: id(), code: 'PO-9', vendorId: vendor._id, project: p2._id, items: [{ productId: product._id, unitPrice: 100, starterQuantity: 8, returnedQuantity: 0 }] });
  await rawEntry('2026-09-12', [ln('wip', 800, 0, { project: p2._id, projectNumber: 'PRJ002' }), ln('suppliers', 0, 800)], { project: p2._id });
  const p2Before = await projectQuantity(product._id, p2._id); // 8 bought + 10 transferred in above, or 8 (if the other request won)
  await assert.rejects(() => inTx(s => recordPucTransfer(product._id, { quantity: p2Before + 1, project: p1._id, sourceType: 'project', sourceProject: p2._id, requestKey: key() }, admin._id, s)), /less than/);
  await assert.rejects(() => inTx(s => recordPucTransfer(product._id, { quantity: 1, project: p2._id, sourceType: 'project', sourceProject: p2._id, requestKey: key() }, admin._id, s)), /must be different/);

  const before = await R['project-profitability']({ from: '2026-01-01', to: '2026-09-30' });
  const pucTotal = before.summary.find(s => s.key === 'pucClosing').value;
  const moved = await inTx(s => recordPucTransfer(product._id, { quantity: 3, project: p1._id, sourceType: 'project', sourceProject: p2._id, date: '2026-09-15', requestKey: key() }, admin._id, s));
  const je = await JournalEntry.findById(moved.transfer.journalEntry).lean();
  assert.deepEqual(je.lines.map(l => [l.debit, l.credit, l.projectNumber]), [[300, 0, 'PRJ001'], [0, 300, 'PRJ002']]);
  assert.equal(await projectQuantity(product._id, p2._id), p2Before - 3);

  const after = await R['project-profitability']({ from: '2026-01-01', to: '2026-09-30' });
  assert.equal(after.summary.find(s => s.key === 'pucClosing').value, pucTotal, 'a transfer between projects leaves company PUC unchanged');
  const row = n => after.sections[0].rows.find(r => r.projectNumber === n);
  const rowBefore = n => before.sections[0].rows.find(r => r.projectNumber === n);
  assert.equal(row('PRJ001').pucClosing, rowBefore('PRJ001').pucClosing + 300);
  assert.equal(row('PRJ002').pucClosing, rowBefore('PRJ002').pucClosing - 300);
  assert.ok(after.checks.every(c => c.ok), after.checks.map(c => `${c.label.en} ${c.detail}`).join(' | '));
});

test('project profitability revenue details list every revenue line and add up to the revenue total, VAT excluded', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  const SalesOrder = require('../../models/sales/salesOrderModel');
  const so = id();
  await SalesOrder.collection.insertOne({ _id: so, code: 'SO-7', customer: customer._id, project: p1._id, items: [{ product: product._id, unitPrice: 150, starterQuantity: 100, returnedQuantity: 0, itemDiscount: { type: 'percentage', value: 10 } }] });
  // Revenue 13,500 + VAT 1,890 on PRJ001, then a 2,000 recognition reversed.
  await rawEntry('2026-09-20', [ln('ar', 15390, 0, { project: p1._id, partyType: 'customer', partyNumber: customer.customerNumber }), ln('revenue', 0, 13500, { project: p1._id }), ln('vat', 0, 1890, { project: p1._id })], { accountingAction: 'PROJECT_REVENUE_RECOGNITION', triggeredBySalesOrder: so, project: p1._id });
  const original = await rawEntry('2026-09-21', [ln('ar', 2000, 0, { project: p1._id }), ln('revenue', 0, 2000, { project: p1._id })], { accountingAction: 'PROJECT_REVENUE_RECOGNITION', triggeredBySalesOrder: so, project: p1._id, status: 'reversed' });
  await rawEntry('2026-09-22', [ln('revenue', 2000, 0, { project: p1._id }), ln('ar', 0, 2000, { project: p1._id })], { reversalOfEntry: original._id, project: p1._id });

  const report = await R['project-profitability']({ from: '2026-09-01', to: '2026-09-30' });
  const detail = report.sections.find(s => s.key === 'revenue');
  assert.equal(report.summary.find(s => s.key === 'revenue').value, 13500);
  assert.equal(detail.totals.amount, 13500);
  assert.deepEqual(detail.rows.map(r => r.amount), [13500, 2000, -2000]);
  const first = detail.rows[0];
  assert.equal(first.salesOrder, 'SO-7');
  assert.equal(first.customer, `${customer.customerNumber} - Delta Builders`);
  assert.equal(first.projectNumber, 'PRJ001');
  assert.equal(first.quantity, 100);
  assert.match(first.items, /Steel Bar x 100 @ 150 less 10%/);
  assert.equal(detail.rows[2].status, 'Reversal');
  assert.equal(detail.rows[2].salesOrder, 'SO-7', 'a reversal shows the order of the entry it reverses');
  assert.ok(report.checks.every(c => c.ok));
  const filtered = await R['project-profitability']({ from: '2026-09-01', to: '2026-09-30', project: String(p2._id) });
  assert.equal(filtered.sections.find(s => s.key === 'revenue').rows.length, 0);
});

// ============================================================ guided tour
test('the guided tour status is stored per user and can be reset', async () => {
  const { updateMyTourStatus } = require('../../controller/user/userController');
  const done = await callHandler(updateMyTourStatus, { body: { status: 'completed' } });
  assert.ok(done.body.data.tour.completedAt);
  const reset = await callHandler(updateMyTourStatus, { body: { status: 'reset' } });
  assert.equal(reset.body.data.tour.completedAt, null);
  await assert.rejects(() => callHandler(updateMyTourStatus, { body: { status: 'nope' } }), /completed, dismissed or reset/);
});

test('route protection: periods and categories are admin-only to change; PUC transfers need products update', async () => {
  const authController = require('../../controller/user/authController');
  const periods = require('../../routes/accounting/accountingPeriodRoute');
  assert.equal(periods.stack[0].handle, authController.protect);
  const closeLayer = periods.stack.find(l => l.route?.path === '/:period/close');
  const call = (handler, user) => new Promise(resolve => handler({ user }, {}, err => resolve(err || null)));
  assert.equal((await call(closeLayer.route.stack[0].handle, { role: 'moderator' }))?.statusCode, 403);
  assert.equal(await call(closeLayer.route.stack[0].handle, { role: 'admin' }), null);

  const puc = require('../../routes/inventory/pucTransferRoute');
  const post = puc.stack.find(l => l.route?.path === '/product/:productId').route.stack.find(s => s.method === 'post');
  assert.equal((await call(post.handle, { role: 'user', permissions: [{ resource: 'products', actions: ['read'] }] }))?.statusCode, 403);
  assert.equal(await call(post.handle, { role: 'user', permissions: [{ resource: 'products', actions: ['read', 'update'] }] }), null);
});
