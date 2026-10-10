const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// General ledger line items, depreciation runs (and their reversal), the PUC / project cost report,
// Purchase Order -> project allocation, Purchase Order payment positions and vendor expenses -
// against one explicit ledger, driven through the real controllers and services. Expected figures
// are worked out by hand in the comments.

const DB_URI = process.env.TEST_DB_URI_LEDGER_PUC || 'mongodb://127.0.0.1:27017/reversia_test_ledger_puc_purchases';
const { AutomaticJournalAccountCodes: C } = require('../../utils/accountingConstants');

let JournalEntry, ChartOfAccount, Vendor, User, Warehouse, Payment, Project, Product, PurchaseOrder, FixedAsset, Expense, PucTransfer, Run;
let createFixedAsset, runDepreciation, updateFixedAsset, createExpense, addExpensePayment;
let createPO, allocateToProject, getProjectAllocation, returnPurchaseOrderItem, createPurchasePayment, reverseJournalEntry;
let purchaseOrderPayments, vendorExpenses, depreciationInPeriod, netBookValueAsOf, closePeriod, reopenPeriod;
let R, runReport, getReport;
let transactionsSupported = true;
const A = {};
let admin, vendor, otherVendor, warehouse, p1, p2;
let entrySeq = 800000;
const id = () => new mongoose.Types.ObjectId();
const sameId = (a, b) => String(a?._id || a) === String(b?._id || b);

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
    };
    Promise.resolve(handler({ headers: {}, query: {}, body: {}, params: {}, user: admin, ...req }, res, err => (err ? reject(err) : resolve({ status: res.statusCode })))).catch(reject);
  });
}
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
async function rawEntry(date, lines, extra = {}) {
  entrySeq += 1;
  const doc = { entryNumber: entrySeq, date: new Date(date), description: 'Fixture', source: 'automatic', status: 'posted', lines: lines.map(l => ({ description: 'Fixture', ...l })), totalDebit: lines.reduce((s, l) => s + (l.debit || 0), 0), totalCredit: lines.reduce((s, l) => s + (l.credit || 0), 0), ...extra };
  const { insertedId } = await JournalEntry.collection.insertOne(doc);
  return { ...doc, _id: insertedId };
}
const ln = (acc, debit, credit, extra = {}) => ({ account: A[acc]._id, debit, credit, ...extra });
const reverse = (entryId, reversalDate) => callHandler(reverseJournalEntry, { params: { id: String(entryId) }, body: { reversalDate: new Date(reversalDate) } });
const stockOf = async product => (await Product.collection.findOne({ _id: product._id })).stock.find(s => sameId(s.warehouse, warehouse)).quantity;

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
  PucTransfer = require('../../models/inventory/pucTransferModel');
  Run = require('../../models/fixedAssetDepreciationRunModel');
  require('../../models/equity/shareholderModel');
  require('../../models/vendor/purchaseOrderReturn');
  ({ createFixedAsset, runDepreciation, updateFixedAsset } = require('../../services/fixedAssets/fixedAssetService'));
  ({ createExpense, addExpensePayment } = require('../../services/expenses/expenseService'));
  ({ createPO, allocateToProject, getProjectAllocation } = require('../../controller/PO/purchaseOrderController'));
  ({ returnPurchaseOrderItem } = require('../../controller/PO/purchaseOrderReturnController'));
  ({ createPurchasePayment } = require('../../controller/PO/PaymentController'));
  ({ reverseJournalEntry } = require('../../controller/accounting/journalEntryController'));
  ({ purchaseOrderPayments } = require('../../services/purchases/purchaseOrderPaymentService'));
  ({ vendorExpenses } = require('../../services/expenses/vendorExpenseService'));
  ({ depreciationInPeriod, netBookValueAsOf } = require('../../services/fixedAssets/depreciationLedgerService'));
  ({ closePeriod, reopenPeriod } = require('../../services/accounting/accountingPeriodService'));
  const { REPORTS_BY_KEY } = require('../../services/reports/reportRegistry');
  R = Object.fromEntries([...REPORTS_BY_KEY].map(([k, r]) => [k, r.run]));
  ({ runReport, getReport } = require('../../controller/reports/accountingReportsController'));
  await Promise.all([JournalEntry.init(), FixedAsset.init(), PucTransfer.init(), PurchaseOrder.init(), Product.init(), Vendor.init(), User.init()]);

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

  const account = (k, code, name, type, parentGroupNameEn = null) => ChartOfAccount.create({ code, name, type, parentGroupNameEn }).then(a => (A[k] = a));
  await account('bank', '11000001', 'Bank Misr', 'asset', 'Cash & Cash Equivalents');
  await account('ar', C.accountsReceivableProjects, 'Accounts Receivable (Projects)', 'asset');
  await account('suppliers', C.suppliers, 'Suppliers', 'liability');
  await account('advance', C.advanceToSuppliers, 'Advances to Suppliers', 'asset');
  await account('inventory', C.materialsInventory, 'Materials Inventory', 'asset');
  await account('wipRaw', C.wipRawMaterials, 'PUC - Raw Materials', 'asset');
  await account('wipLabour', C.wipLabourWages, 'PUC - Labour Wages', 'asset');
  await account('wipDesign', C.wipEngineeringDesign, 'PUC - Engineering & Design', 'asset');
  await account('wipEquipment', '11000030', 'PUC - Equipment Rental', 'asset');
  await account('inputVat', C.inputVat, 'Input VAT', 'asset');
  await account('whtPayable', C.withholdingTaxPayable, 'Withholding Taxes Payable', 'liability');
  await account('revenue', C.revenue, 'Revenue', 'revenue');
  await account('cogsRaw', '50000001', 'Raw Materials', 'cogs');
  await account('vehicles', '12000001', 'Vehicles', 'asset', 'Property, Plant & Equipment');
  await account('accDep', '12000099', 'Accumulated Depreciation – Fixed Assets', 'asset', 'Property, Plant & Equipment');
  await account('software', '13000001', 'Software Licenses', 'asset', 'Intangible Assets');
  await account('accAmort', '13000099', 'Accumulated Amortization - Intangible Assets', 'asset', 'Intangible Assets');
  await account('depExp', '62000001', 'Depreciation & Amortization', 'expense', 'Operating Expenses');
  await account('rent', '61000001', 'Office Rent', 'expense');

  admin = await User.create({ name: 'Admin', email: `admin-${Date.now()}@example.com`, role: 'admin', type: 'online' });
  admin.id = String(admin._id);
  vendor = await Vendor.create({ name: 'Steel Co', contact: { phone: `010${Date.now()}`.slice(0, 11) } });
  otherVendor = await Vendor.create({ name: 'Other Supplier', contact: { phone: `011${Date.now()}`.slice(0, 11) } });
  warehouse = await Warehouse.create({ name: 'Head Office', location: 'Cairo', balance: 1000000 });
  p1 = await Project.create({ projectNumber: 'PRJ001', name: 'Villa', contractValue: 500000, executedPercentage: 20, startDate: new Date('2026-01-01'), deliveryDate: new Date('2026-12-31') });
  p2 = await Project.create({ projectNumber: 'PRJ002', name: 'Factory', startDate: new Date('2026-01-01'), deliveryDate: new Date('2026-12-31') });
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

// ============================================================ depreciation
test('depreciation run: correct amounts and accounts, an audited run record, no duplicates, nothing skipped silently', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  // Truck 60,000 / 60 months = 1,000 a month; licence 12,000 / 24 = 500 a month (amortization).
  const truck = await inTx(s => createFixedAsset({ name: 'Truck', vendor: vendor._id, assetAccountId: A.vehicles._id, accumulatedAccountId: A.accDep._id, depreciationAccountId: A.depExp._id, acquisitionDate: new Date('2026-01-10'), price: 60000, usefulLifeMonths: 60, vatPercentage: 0 }, admin._id, s));
  const licence = await inTx(s => createFixedAsset({ name: 'ERP Licence', vendor: vendor._id, assetAccountId: A.software._id, accumulatedAccountId: A.accAmort._id, depreciationAccountId: A.depExp._id, acquisitionDate: new Date('2026-02-01'), price: 12000, usefulLifeMonths: 24, vatPercentage: 0 }, admin._id, s));
  const legacy = await FixedAsset.create({ name: 'Old Printer', price: 3000, bookValue: 3000, acquisitionDate: new Date('2025-06-01') });
  // Under maintenance - still depreciated (an idle asset keeps depreciating).
  await inTx(s => updateFixedAsset(licence._id, { status: 'under_maintenance' }, s));

  // March only: January and February of the truck, and February of the licence, were never run.
  const march = await inTx(s => runDepreciation({ period: '2026-03', userId: admin._id }, s));
  assert.deepEqual(march.processed.map(p => [p.name, p.amount]).sort(), [['ERP Licence', 500], ['Truck', 1000]]);
  assert.equal(march.totalAmount, 1500);
  assert.match(march.skipped.find(s => s.name === 'Old Printer').reason, /No useful life or depreciation accounts/);
  assert.deepEqual(march.missingEarlierMonths.find(m => m.name === 'Truck').periods, ['2026-01', '2026-02']);
  assert.deepEqual(march.missingEarlierMonths.find(m => m.name === 'ERP Licence').periods, ['2026-02']);

  const truckEntry = await JournalEntry.findById(march.processed.find(p => p.name === 'Truck').journalEntry).lean();
  assert.equal(truckEntry.status, 'posted');
  assert.equal(truckEntry.totalDebit, truckEntry.totalCredit);
  assert.deepEqual(truckEntry.lines.map(l => [String(l.account._id || l.account), l.debit, l.credit]), [[String(A.depExp._id), 1000, 0], [String(A.accDep._id), 0, 1000]]);
  assert.match(truckEntry.reference, /^Depreciation run 2026-03/);
  const licenceEntry = await JournalEntry.findById(march.processed.find(p => p.name === 'ERP Licence').journalEntry).lean();
  assert.equal(String(licenceEntry.lines[1].account._id || licenceEntry.lines[1].account), String(A.accAmort._id), 'amortization credits accumulated amortization');
  assert.equal(licenceEntry.description, 'Amortization - ERP Licence - 2026-03');

  const run = await Run.findById(march.run).lean();
  assert.equal(run.processed.length, 2);
  assert.equal(run.skipped.length, 1);
  const stored = await FixedAsset.findById(truck._id).lean();
  assert.equal(String(stored.depreciations[0].run), String(march.run), 'the asset links the month to its run');

  // Running March again posts nothing new.
  const again = await inTx(s => runDepreciation({ period: '2026-03', userId: admin._id }, s));
  assert.equal(again.processed.length, 0);
  assert.equal(again.skipped.filter(s => s.reason === 'Already depreciated for this month').length, 2);
  assert.equal(await JournalEntry.countDocuments({ accountingAction: 'FIXED_ASSET_DEPRECIATION' }), 2);
  assert.equal((await FixedAsset.findById(legacy._id).lean()).bookValue, 3000, 'the legacy asset is untouched');
});

test('a reversed depreciation entry gives the month back to the asset, which can then be depreciated again', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  const truck = await FixedAsset.findOne({ name: 'Truck' });
  const entry = await JournalEntry.findOne({ accountingAction: 'FIXED_ASSET_DEPRECIATION', description: 'Depreciation - Truck - 2026-03' });
  await reverse(entry._id, '2026-03-31');
  let stored = await FixedAsset.findById(truck._id).lean();
  assert.equal(stored.bookValue, 60000);
  assert.equal(stored.accumulatedDepreciation, 0);
  assert.equal(stored.depreciations[0].reversed, true, 'the reversed month stays on record, flagged');

  const redo = await inTx(s => runDepreciation({ period: '2026-03', userId: admin._id }, s));
  assert.deepEqual(redo.processed.map(p => [p.name, p.amount]), [['Truck', 1000]]);
  assert.notEqual(String(redo.processed[0].journalEntry), String(entry._id), 'a new entry, not the reversed one');
  stored = await FixedAsset.findById(truck._id).lean();
  assert.equal(stored.bookValue, 59000);
  assert.equal(stored.depreciations.filter(d => !d.reversed).length, 1);
});

test('depreciation is in the general ledger, trial balance, profit or loss, balance sheet and the legacy reports - once', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  // March: truck 1,000 (posted, reversed, posted again = net 1,000) + licence 500.
  const march = { from: '2026-03-01', to: '2026-03-31' };
  const tb = await R['trial-balance'](march);
  const tbRow = tb.sections.flatMap(s => s.rows).find(r => r.code === '62000001');
  assert.equal(tbRow.periodDebit - tbRow.periodCredit, 1500);
  const pl = await R['profit-loss'](march);
  assert.equal(pl.summary.find(s => s.key === 'netProfit').value, -1500);
  const pos = await R['financial-position']({ asOf: '2026-03-31' });
  const posRows = pos.sections.flatMap(s => s.rows);
  assert.equal(posRows.find(r => r.code === '12000001').amount, 60000, 'cost stays separate');
  assert.equal(posRows.find(r => r.code === '12000099').amount, -1000);
  const gl = await R['general-ledger']({ ...march, account: String(A.depExp._id) });
  assert.equal(gl.sections[0].rows.length, 4, '1,000 + 500 + the reversed 1,000 + its reversal');
  assert.equal(gl.summary.find(s => s.key === 'closing').value, 1500);
  // Legacy Reports: the month's depreciation, and the net book value at a date.
  assert.equal(await depreciationInPeriod(new Date('2026-03-01'), new Date('2026-03-31T23:59:59Z')), 1500);
  assert.equal(await depreciationInPeriod(new Date('2026-01-01'), new Date('2026-02-28T23:59:59Z')), 0, 'nothing posted for January or February');
  assert.equal(await netBookValueAsOf(new Date('2026-03-31T23:59:59Z')), 60000 - 1000 + 12000 - 500 + 3000);
  assert.equal(await netBookValueAsOf(new Date('2026-02-28T23:59:59Z')), 60000 + 12000 + 3000, 'March depreciation is not deducted at a February date');
  const fixedAssetRegister = await R['fixed-asset-register']({ asOf: '2026-03-31' });
  assert.ok(fixedAssetRegister.checks.every(c => c.ok), JSON.stringify(fixedAssetRegister.checks));
});

test('a closed period cannot be depreciated and nothing is written', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  await closePeriod('2026-04', admin._id);
  const before = await JournalEntry.countDocuments({});
  await assert.rejects(() => inTx(s => runDepreciation({ period: '2026-04', userId: admin._id }, s)), /Accounting period is closed/);
  assert.equal(await JournalEntry.countDocuments({}), before);
  assert.equal(await Run.countDocuments({ period: '2026-04' }), 0);
  await reopenPeriod('2026-04', admin._id);
});

// ============================================================ General Ledger line items
test('general ledger lines: account numbers, filters, normal-balance running balances, sorting, paging and reconciliation', async () => {
  // Supplier movements in May, plus a draft (never in the ledger) and a reversed pair.
  await rawEntry('2026-05-02', [ln('rent', 2000, 0), ln('suppliers', 0, 2000, { partyType: 'vendor', partyNumber: vendor.vendorNumber, project: p1._id })]);
  await rawEntry('2026-05-05', [ln('suppliers', 500, 0, { partyType: 'vendor', partyNumber: vendor.vendorNumber }), ln('bank', 0, 500)]);
  await rawEntry('2026-05-06', [ln('rent', 999, 0), ln('suppliers', 0, 999)], { status: 'draft' });
  const reversed = await rawEntry('2026-05-07', [ln('rent', 300, 0), ln('suppliers', 0, 300, { partyType: 'vendor', partyNumber: otherVendor.vendorNumber })], { status: 'reversed' });
  await rawEntry('2026-05-08', [ln('suppliers', 300, 0, { partyType: 'vendor', partyNumber: otherVendor.vendorNumber }), ln('rent', 0, 300)], { reversalOfEntry: reversed._id });

  const may = { from: '2026-05-01', to: '2026-05-31' };
  const suppliers = await R['general-ledger']({ ...may, account: String(A.suppliers._id) });
  const rows = suppliers.sections[0].rows;
  assert.deepEqual(rows.map(r => [r.accountCode, r.accountName, r.debit, r.credit]), [
    ['31000001', 'Suppliers', 0, 2000],
    ['31000001', 'Suppliers', 500, 0],
    ['31000001', 'Suppliers', 0, 300],
    ['31000001', 'Suppliers', 300, 0],
  ]);
  // Suppliers is a liability: balances run on the credit side. Opening = the fixed asset acquisitions
  // (60,000 + 12,000 credited to Suppliers before May).
  const opening = suppliers.summary.find(s => s.key === 'opening').value;
  assert.equal(opening, 72000);
  assert.deepEqual(rows.map(r => r.balance), [74000, 73500, 73800, 73500]);
  assert.equal(suppliers.summary.find(s => s.key === 'closing').value, 73500);
  assert.equal(rows[0].party, `Vendor ${vendor.vendorNumber} - Steel Co`);
  assert.equal(rows[0].subAccountNumber, String(vendor.vendorNumber));
  assert.equal(rows[0].projectNumber, 'PRJ001');
  assert.deepEqual(rows.map(r => r.status), ['Posted', 'Posted', 'Reversed', 'Reversal']);
  assert.ok(suppliers.checks.every(c => c.ok), JSON.stringify(suppliers.checks));

  // Every account, the whole period: debits = credits and = the trial balance.
  const all = await R['general-ledger'](may);
  assert.ok(all.checks.every(c => c.ok), JSON.stringify(all.checks));
  assert.equal(all.summary.find(s => s.key === 'debit').value, all.summary.find(s => s.key === 'credit').value);
  assert.ok(!all.sections[0].rows.some(r => r.debit === 999 || r.credit === 999), 'drafts are not in the ledger');

  // Filters.
  assert.equal((await R['general-ledger']({ ...may, vendor: String(vendor._id) })).sections[0].rows.length, 2);
  assert.equal((await R['general-ledger']({ ...may, project: String(p1._id) })).sections[0].rows.length, 1);
  assert.equal((await R['general-ledger']({ ...may, entryNumber: String(reversed.entryNumber) })).sections[0].rows.length, 2);
  assert.equal((await R['general-ledger']({ ...may, search: 'other supplier' })).sections[0].rows.length, 2);
  assert.equal((await R['general-ledger']({ from: '2026-05-01', to: '2026-05-04', account: String(A.suppliers._id) })).sections[0].rows.length, 1, 'date range');
  await assert.rejects(() => R['general-ledger']({ ...may, sort: 'bogus' }), /Invalid sort/);
  const desc = await R['general-ledger']({ ...may, account: String(A.suppliers._id), sort: '-entryNumber' });
  assert.deepEqual(desc.sections[0].rows.map(r => r.entryNumber), [...rows.map(r => r.entryNumber)].reverse());
  assert.deepEqual(desc.sections[0].rows.map(r => r.balance), [...rows.map(r => r.balance)].reverse(), 'running balances follow the date order whatever the sort');

  // Paging through the report endpoint: totals cover every row.
  const page = await callHandler(getReport, { params: { key: 'general-ledger' }, query: { ...may, account: String(A.suppliers._id), page: '2', pageSize: '3' } });
  const lines = page.body.data.sections[0];
  assert.equal(lines.rows.length, 1);
  assert.deepEqual(lines.pagination, { page: 2, pageSize: 3, totalRows: 4, totalPages: 2 });
  assert.equal(lines.totals.credit, 2300);
});

// ============================================================ Purchase Orders: allocation, payments
let steel, design, po;
test('a Purchase Order: received stock goes on to the project automatically - unallocated 0, no extra journal entry', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  steel = await Product.create({ type: 'product', title: { en: 'Steel Bar', ar: 'حديد' }, description: { en: 'd', ar: 'د' }, price: 300, cost: 100, category: id(), subcategory: id(), stock: [{ warehouse: warehouse._id, quantity: 5 }] });
  design = await Product.create({ type: 'service', title: { en: 'Design Work', ar: 'تصميم' }, description: { en: 'd', ar: 'د' }, price: 2000, durationValue: 1, durationUnit: 'month', pucAccount: A.wipDesign._id });
  // 10 bars at 100 (1,000) + a design service 2,000; 14% VAT.
  const res = await callHandler(createPO, { body: { vendorId: String(vendor._id), warehouseId: String(warehouse._id), project: String(p1._id), vatPercentage: 14, items: [{ productId: steel._id, unitPrice: 100, starterQuantity: 10 }, { productId: design._id, unitPrice: 2000, starterQuantity: 1 }] } });
  assert.equal(res.status, 201);
  po = res.body.data;
  assert.equal(await stockOf(steel), 5, 'received (+10) and allocated to the project (-10): the warehouse keeps its own 5');

  const state = (await callHandler(getProjectAllocation, { params: { id: String(po._id) } })).body.data;
  assert.equal(state.status, 'allocated');
  const bar = state.lines.find(l => sameId(l.product._id, steel));
  assert.deepEqual([bar.ordered, bar.received, bar.returned, bar.allocated, bar.unallocated], [10, 10, 0, 10, 0]);
  const service = state.lines.find(l => sameId(l.product._id, design));
  assert.deepEqual([service.stock, service.allocated, service.unallocated], [false, 0, 0], 'a service has no stock to allocate');
  assert.equal(state.journalEntry.entryNumber > 0, true, 'linked to the order\'s PO_INVENTORY_TO_WIP entry');
  const records = await PucTransfer.find({ purchaseOrder: po._id }).lean();
  assert.equal(records.length, 1);
  assert.equal(String(records[0].journalEntry), String(state.journalEntry._id));
  assert.equal(await JournalEntry.countDocuments({ sourceType: 'PO', sourceId: new mongoose.Types.ObjectId(po._id) }), 3, 'receipt, inventory-to-WIP and service-to-WIP - nothing more');

  // Retried and concurrent allocation requests change nothing.
  await callHandler(allocateToProject, { params: { id: String(po._id) } });
  await Promise.allSettled([callHandler(allocateToProject, { params: { id: String(po._id) } }), callHandler(allocateToProject, { params: { id: String(po._id) } })]);
  assert.equal(await PucTransfer.countDocuments({ purchaseOrder: po._id }), 1);
  assert.equal(await stockOf(steel), 5);
});

test('a return releases the project allocation first; an order created before automatic allocation can be allocated safely', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  await callHandler(returnPurchaseOrderItem, { body: { purchaseOrderId: String(po._id), warehouseId: String(warehouse._id), productId: String(steel._id), returnedQuantity: 4, paymentMethod: 'cash' } });
  assert.equal(await stockOf(steel), 5, '4 released back from the project, then 4 returned to the supplier');
  const state = (await callHandler(getProjectAllocation, { params: { id: String(po._id) } })).body.data;
  const bar = state.lines.find(l => sameId(l.product._id, steel));
  assert.deepEqual([bar.received, bar.returned, bar.allocated, bar.unallocated], [10, 4, 6, 0]);

  // A legacy order: 8 received into stock, never allocated.
  const legacyId = id();
  const lineId = id();
  await PurchaseOrder.collection.insertOne({ _id: legacyId, code: 'PO-LEGACY', vendorId: vendor._id, warehouseId: warehouse._id, project: p2._id, items: [{ _id: lineId, productId: steel._id, unitPrice: 100, unitPriceAfterDiscount: 100, starterQuantity: 8, returnedQuantity: 0, subtotal: 800 }], totalAmount: 800, grandTotal: 800, paidAmount: 0 });
  await Product.collection.updateOne({ _id: steel._id, 'stock.warehouse': warehouse._id }, { $inc: { 'stock.$.quantity': 8 } });
  const allocated = (await callHandler(allocateToProject, { params: { id: String(legacyId) } })).body.data;
  assert.equal(allocated.lines[0].unallocated, 0);
  assert.equal(await stockOf(steel), 5);
  // Not enough left in the warehouse: refused, nothing allocated.
  const short = id();
  await PurchaseOrder.collection.insertOne({ _id: short, code: 'PO-SHORT', vendorId: vendor._id, warehouseId: warehouse._id, project: p2._id, items: [{ _id: id(), productId: steel._id, unitPrice: 100, unitPriceAfterDiscount: 100, starterQuantity: 50, returnedQuantity: 0, subtotal: 5000 }], totalAmount: 5000, grandTotal: 5000, paidAmount: 0 });
  await assert.rejects(() => callHandler(allocateToProject, { params: { id: String(short) } }), /no longer holds that quantity/);
  assert.equal(await PucTransfer.countDocuments({ purchaseOrder: short }), 0);
  assert.equal(await stockOf(steel), 5);
});

test('Purchase Order payments: unpaid, partially paid, paid, a reversed payment, and an advance applied on creation', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  // After the return: 6 bars (600) + design 2,000 = 2,600 + 14% VAT 364 = 2,964 payable.
  let pay = await purchaseOrderPayments(po._id);
  assert.deepEqual([pay.summary.subtotal, pay.summary.vat, pay.summary.withholding, pay.summary.total, pay.summary.totalPaid, pay.summary.outstanding, pay.summary.status], [2600, 364, 0, 2964, 0, 2964, 'unpaid']);
  assert.equal(pay.summary.returns, 400);

  const payBody = amount => ({ body: { warehouseId: String(warehouse._id), purchaseOrderId: String(po._id), amountPaid: amount, paymentAccount: String(A.bank._id), notes: `Cheque ${amount}` } });
  await callHandler(createPurchasePayment, payBody(1000));
  await callHandler(createPurchasePayment, payBody(964));
  pay = await purchaseOrderPayments(po._id);
  assert.deepEqual([pay.summary.totalPaid, pay.summary.outstanding, pay.summary.status], [1964, 1000, 'partially_paid']);
  assert.equal(pay.payments.length, 2);
  assert.ok(pay.payments.every(p => p.status === 'posted' && p.journalEntry && p.allocated === p.amount));

  await callHandler(createPurchasePayment, payBody(1000));
  pay = await purchaseOrderPayments(po._id);
  assert.deepEqual([pay.summary.totalPaid, pay.summary.outstanding, pay.summary.status], [2964, 0, 'paid']);
  assert.equal((await PurchaseOrder.findById(po._id).lean()).paymentStatus, 'paid');

  // Reversing the 964 payment's entry: the order is partially paid again - stored status included.
  const vendorBefore = (await Vendor.findById(vendor._id).lean()).balance;
  const entry = pay.payments.find(p => p.amount === 964).journalEntry;
  await reverse(entry._id, '2026-06-30');
  pay = await purchaseOrderPayments(po._id);
  assert.deepEqual([pay.summary.totalPaid, pay.summary.outstanding, pay.summary.status], [2000, 964, 'partially_paid']);
  assert.equal(pay.payments.find(p => p.amount === 964).status, 'reversed');
  const stored = await PurchaseOrder.findById(po._id).lean();
  assert.deepEqual([stored.paidAmount, stored.paymentStatus], [2000, 'partial']);
  assert.equal((await Vendor.findById(vendor._id).lean()).balance, vendorBefore + 964, 'the vendor is owed it again');
  await assert.rejects(() => reverse(entry._id, '2026-06-30'), /Only posted journal entries can be reversed|already been reversed/);

  // An Advanced Payment applied when an order was created counts as paid.
  const other = (await callHandler(createPO, { body: { vendorId: String(vendor._id), warehouseId: String(warehouse._id), project: String(p2._id), items: [{ productId: steel._id, unitPrice: 100, starterQuantity: 1 }] } })).body.data;
  await rawEntry('2026-06-02', [ln('suppliers', 60, 0), ln('advance', 0, 60)], { sourceType: 'PO', sourceId: new mongoose.Types.ObjectId(other._id), accountingAction: 'PO_SUPPLIER_ADVANCE_APPLIED' });
  pay = await purchaseOrderPayments(other._id);
  assert.deepEqual([pay.summary.total, pay.summary.totalPaid, pay.summary.outstanding, pay.summary.status], [100, 60, 40, 'partially_paid']);
});

// ============================================================ PUC / project costs
test('PUC / project cost report: categories, transactions, no double counting, and reconciliation', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  // On top of the Purchase Order above (PRJ001: raw materials 1,000, design 2,000), July:
  // labour 4,000 and equipment 1,500 on PRJ001; 2,500 of raw materials recognized as cost of sales.
  await rawEntry('2026-07-01', [ln('wipLabour', 4000, 0, { project: p1._id }), ln('suppliers', 0, 4000)], { project: p1._id });
  await rawEntry('2026-07-02', [ln('wipEquipment', 1500, 0, { project: p1._id }), ln('suppliers', 0, 1500)], { project: p1._id });
  await rawEntry('2026-07-20', [ln('cogsRaw', 500, 0, { project: p1._id }), ln('wipRaw', 0, 500, { project: p1._id })], { project: p1._id, accountingAction: 'PROJECT_COST_RECOGNITION' });

  const report = await R['project-costs']({ from: '2026-01-01', to: '2026-12-31' });
  const prj1 = report.sections.find(s => s.key === 'projects').rows.find(r => r.projectNumber === 'PRJ001');
  // Added: the order's 1,000 bars (allocated, then 4 returned - returns post no entry in Reservia)
  // + 2,000 design + 4,000 labour + 1,500 equipment = 8,500; relieved 500.
  assert.deepEqual([prj1.costsAdded, prj1.costsRelieved, prj1.pucClosing, prj1.costOfSales], [8500, 500, 8000, 500]);
  const cats = report.sections.find(s => s.key === 'categories').rows.find(r => r.projectNumber === 'PRJ001');
  assert.deepEqual([cats.cat_materials, cats.cat_labor, cats.cat_design, cats.cat_equipment, cats.total], [500, 4000, 2000, 1500, 8000]);
  assert.ok(report.checks.every(c => c.ok), JSON.stringify(report.checks));
  const tx = report.sections.find(s => s.key === 'transactions').rows.filter(r => r.projectNumber === 'PRJ001');
  const bars = tx.find(r => r.category === 'Materials' && r.costAdded === 1000);
  assert.equal(bars.sourceType, 'Purchase Order');
  assert.match(bars.item, /Steel Bar x 6 @ 100/);
  // The Purchase Order is listed for reference and never added to PUC.
  const orderRow = report.sections.find(s => s.key === 'purchaseOrders').rows.find(r => r.code === po.code);
  assert.deepEqual([orderRow.ordered, orderRow.received, orderRow.recognized, orderRow.total, orderRow.paid], [3000, 2600, 3000, 2964, 2000]);

  const designOnly = await R['project-costs']({ from: '2026-01-01', to: '2026-12-31', category: 'design', project: String(p1._id) });
  assert.equal(designOnly.sections.find(s => s.key === 'transactions').rows.length, 1);
  assert.equal(designOnly.summary.find(s => s.key === 'pucClosing').value, 2000);
});

// ============================================================ vendor expenses
test('vendor expenses: only the vendor\'s own, paid / outstanding from live payments, cancelled ones out of the totals', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  // Steel Co: rent 1,000 + 14% (1,140), paid 600 then 200 (the 200 is reversed); rent 500 cancelled.
  const e1 = await inTx(s => createExpense({ vendor: vendor._id, expenseAccount: A.rent._id, amount: 1000, vatPercentage: 14, date: '2026-08-01', reference: 'INV-1' }, admin._id, s));
  await inTx(s => addExpensePayment(e1._id, { amount: 600, paymentAccount: A.bank._id, warehouseId: warehouse._id, date: '2026-08-02' }, admin._id, s));
  await inTx(s => addExpensePayment(e1._id, { amount: 200, paymentAccount: A.bank._id, warehouseId: warehouse._id, date: '2026-08-03' }, admin._id, s));
  const e2 = await inTx(s => createExpense({ vendor: vendor._id, expenseAccount: A.rent._id, amount: 500, date: '2026-08-04' }, admin._id, s));
  await inTx(s => createExpense({ vendor: otherVendor._id, expenseAccount: A.rent._id, amount: 777, date: '2026-08-05' }, admin._id, s));

  const stored = await Expense.findById(e1._id).lean();
  await reverse(stored.payments[1].journalEntry, '2026-08-10');
  await reverse((await Expense.findById(e2._id).lean()).journalEntry, '2026-08-10');

  const list = await vendorExpenses(vendor._id, { from: '2026-08-01', to: '2026-08-31' });
  assert.equal(list.expenses.length, 2);
  const inv = list.expenses.find(e => e.reference === 'INV-1');
  assert.deepEqual([inv.amount, inv.vat, inv.total, inv.paid, inv.outstanding, inv.paymentStatus], [1000, 140, 1140, 600, 540, 'partially_paid']);
  assert.equal(list.expenses.find(e => e.amount === 500).paymentStatus, 'cancelled');
  assert.deepEqual(list.totals, { count: 1, amount: 1000, vat: 140, total: 1140, paid: 600, outstanding: 540, cancelled: 1 });
  assert.equal((await Expense.findById(e1._id).lean()).paidAmount, 600, 'the expense record itself no longer counts the reversed payment');
  assert.equal((await vendorExpenses(vendor._id, { status: 'paid' })).expenses.length, 0);
  assert.equal((await vendorExpenses(otherVendor._id)).expenses.length, 1, 'never another vendor\'s');
  assert.deepEqual((await vendorExpenses(id())).expenses, []);
  await assert.rejects(() => vendorExpenses(vendor._id, { from: '08/01/2026' }), /YYYY-MM-DD/);
});

test('reports and the new endpoints never change data', async () => {
  const counts = async () => Promise.all(['journalentries', 'fixedassets', 'purchaseorders', 'payments', 'expenses', 'puctransfers', 'products'].map(c => mongoose.connection.collection(c).countDocuments()));
  const beforeCounts = await counts();
  await runReport('general-ledger', { from: '2026-01-01', to: '2026-12-31' });
  await runReport('project-costs', { from: '2026-01-01', to: '2026-12-31' });
  await purchaseOrderPayments(po._id);
  await vendorExpenses(vendor._id);
  assert.deepEqual(await counts(), beforeCounts);
});
