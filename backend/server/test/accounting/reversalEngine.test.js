const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// The accounting reversal engine (services/accounting/reversalService.js) driven through the real
// order, payment and advance flows: purchase returns (goods and services, VAT + withholding, partial
// and full, with a vendor refund), sales returns (project revenue / VAT / receivable / cost
// de-recognition, service lines, customer refund), payment reversals, settlement reversals, the
// manual journal-entry reversal guards, idempotency, concurrency, rollback and the ledger balances
// that must come out of all of it. Every expected amount is worked out by hand in the comments.

const DB_URI = process.env.TEST_DB_URI_REVERSALS || 'mongodb://127.0.0.1:27017/reversia_test_reversal_engine';
const { AutomaticJournalAccountCodes: C } = require('../../utils/accountingConstants');

let JournalEntry, ChartOfAccount, Vendor, User, Warehouse, Payment, Project, Product, PurchaseOrder, SalesOrder, AdvancedPayment, AccountingReversal;
let createPO, createPurchasePayment, createSalesPayment, createAdvancedPayment, reverseJournalEntry, cancelOrder;
let createSalesOrder, engine, getTrialBalance;
let transactionsSupported = true;
const A = {};
let admin, vendor, customer, warehouse, project, steel, design, panel, consulting;
const id = () => new mongoose.Types.ObjectId();
let keySeq = 0;
const key = () => `test-${Date.now()}-${(keySeq += 1)}`;

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
const linesOf = entry => entry.lines.map(l => [Object.keys(A).find(k => String(A[k]._id) === String(l.account?._id || l.account)), l.debit, l.credit]).sort((a, b) => a[0].localeCompare(b[0]));
const balanceOf = async (accountKey, partyNumber) => {
  const rows = await JournalEntry.aggregate([{ $match: { status: { $in: ['posted', 'reversed'] } } }, { $unwind: '$lines' }, { $match: { 'lines.account': A[accountKey]._id, ...(partyNumber != null ? { 'lines.partyNumber': partyNumber } : {}) } }, { $group: { _id: null, d: { $sum: '$lines.debit' }, c: { $sum: '$lines.credit' } } }]);
  return Math.round(((rows[0]?.d || 0) - (rows[0]?.c || 0)) * 100) / 100;
};
const stockOf = async product => (await Product.collection.findOne({ _id: product._id })).stock.find(s => String(s.warehouse) === String(warehouse._id))?.quantity;
const balanced = entry => assert.equal(Math.round(entry.lines.reduce((s, l) => s + l.debit - l.credit, 0) * 100), 0, `entry #${entry.entryNumber} is balanced`);

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
  SalesOrder = require('../../models/sales/salesOrderModel');
  AdvancedPayment = require('../../models/payments/advancedPaymentModel');
  AccountingReversal = require('../../models/accounting/accountingReversalModel');
  require('../../models/equity/shareholderModel');
  require('../../models/vendor/purchaseOrderReturn');
  require('../../models/sales/salesOrderReturnModel');
  ({ createPO } = require('../../controller/PO/purchaseOrderController'));
  ({ createPurchasePayment, createSalesPayment } = require('../../controller/PO/PaymentController'));
  ({ createAdvancedPayment } = require('../../controller/payments/advancedPaymentController'));
  ({ reverseJournalEntry } = require('../../controller/accounting/journalEntryController'));
  ({ cancelOrder } = require('../../controller/sales/salesOrderController'));
  ({ createSalesOrder } = require('../../services/sales/salesOrderCreation.service'));
  ({ getTrialBalance } = require('../../services/accounting/generalLedgerService'));
  engine = require('../../services/accounting/reversalService');
  await Promise.all([JournalEntry.init(), PurchaseOrder.init(), SalesOrder.init(), Product.init(), Vendor.init(), User.init(), AccountingReversal.init(), AdvancedPayment.init()]);

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
  await account('custAdv', C.customerAdvancesPayable, 'Customer Advances', 'liability');
  await account('suppliers', C.suppliers, 'Suppliers', 'liability');
  await account('supAdv', C.advanceToSuppliers, 'Advances to Suppliers', 'asset');
  await account('inventory', C.materialsInventory, 'Materials Inventory', 'asset');
  await account('wipRaw', C.wipRawMaterials, 'PUC - Raw Materials', 'asset');
  await account('wipDesign', C.wipEngineeringDesign, 'PUC - Engineering & Design', 'asset');
  await account('inputVat', C.inputVat, 'Input VAT', 'asset');
  await account('vat', C.vatPayable, 'VAT Payable', 'liability');
  await account('whtPayable', C.withholdingTaxPayable, 'Withholding Taxes Payable', 'liability');
  await account('whtRec', C.withholdingTaxReceivable, 'Withholding Receivable', 'asset');
  await account('revenue', C.revenue, 'Revenue', 'revenue');
  await account('cogsRaw', '50000001', 'Raw Materials', 'cogs');
  await account('sales', '40000001', 'Sales Income', 'revenue'); // not a cash account: refused as a refund account

  admin = await User.create({ name: 'Admin', email: `admin-${Date.now()}@example.com`, role: 'admin', type: 'online' });
  admin.id = String(admin._id);
  customer = await User.create({ name: 'Delta Builders', email: `cust-${Date.now()}@example.com`, role: 'user', type: 'online' });
  vendor = await Vendor.create({ name: 'Steel Co', contact: { phone: `010${Date.now()}`.slice(0, 11) } });
  warehouse = await Warehouse.create({ name: 'Head Office', location: 'Cairo', balance: 1000000 });
  // Contract 100,000; average cost: raw materials 40,000.
  project = await Project.create({ projectNumber: 'PRJ001', name: 'Villa', customer: customer._id, contractValue: 100000, startDate: new Date('2026-01-01'), deliveryDate: new Date('2026-12-31'), averageCostLines: [{ account: A.cogsRaw._id, amount: 40000 }] });
  const product = (title, extra) => Product.create({ type: 'product', title: { en: title, ar: title }, description: { en: 'd', ar: 'د' }, price: 100, cost: 100, category: id(), subcategory: id(), ...extra });
  steel = await product('Steel Bar', { stock: [{ warehouse: warehouse._id, quantity: 5 }] });
  panel = await product('Solar Panel', { price: 2000, stock: [{ warehouse: warehouse._id, quantity: 100 }] });
  design = await Product.create({ type: 'service', title: { en: 'Design Work', ar: 'تصميم' }, description: { en: 'd', ar: 'د' }, price: 2000, durationValue: 1, durationUnit: 'month', pucAccount: A.wipDesign._id });
  consulting = await Product.create({ type: 'service', title: { en: 'Consulting', ar: 'استشارات' }, description: { en: 'd', ar: 'د' }, price: 1000, durationValue: 1, durationUnit: 'month', pucAccount: A.wipDesign._id });
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

// ============================================================ purchase returns
let po;
test('partial purchase return of goods: the returned slice of the receipt is reversed from WIP, with VAT and withholding; stock and allocation follow', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  // 10 bars at 100 + a design service 2,000 = 3,000; VAT 14% = 420; withholding 1% = 30; total 3,390.
  const res = await callHandler(createPO, { body: { vendorId: String(vendor._id), warehouseId: String(warehouse._id), project: String(project._id), vatPercentage: 14, withholdingTaxPercentage: 1, items: [{ productId: steel._id, unitPrice: 100, starterQuantity: 10 }, { productId: design._id, unitPrice: 2000, starterQuantity: 1 }] } });
  po = res.body.data;
  assert.equal(po.grandTotal, 3390);
  assert.equal(await stockOf(steel), 5, 'received and allocated to the project');
  const vendorNumber = (await Vendor.findById(vendor._id)).vendorNumber;
  assert.equal(await balanceOf('suppliers', vendorNumber), -3390);

  // Return 4 bars: net 400, VAT 56, withholding 4.
  const { reversal } = await engine.returnPurchaseOrder({ purchaseOrderId: po._id, items: [{ productId: String(steel._id), quantity: 4 }], warehouseId: String(warehouse._id), reason: 'Damaged bars', idempotencyKey: key(), userId: admin._id });
  assert.deepEqual([reversal.type, reversal.scope, reversal.amount], ['purchase_return', 'partial', 452]);
  const [entry] = await JournalEntry.find({ _id: { $in: reversal.reversalEntries } }).lean();
  assert.equal(entry.accountingAction, 'PURCHASE_RETURN');
  balanced(entry);
  // Dr Suppliers 452 (vendor), Dr WHT payable 4 / Cr PUC - Raw Materials 400, Cr Input VAT 56.
  assert.deepEqual(linesOf(entry), [['inputVat', 0, 56], ['suppliers', 452, 0], ['whtPayable', 4, 0], ['wipRaw', 0, 400]]);
  assert.equal(entry.lines.find(l => String(l.account?._id || l.account) === String(A.suppliers._id)).partyNumber, vendorNumber, 'vendor sub account kept');
  assert.ok(entry.lines.every(l => l.projectNumber === 'PRJ001'), 'project number on every line');
  const toWip = await JournalEntry.findOne({ sourceId: new mongoose.Types.ObjectId(po._id), accountingAction: 'PO_INVENTORY_TO_WIP' }).lean();
  assert.equal(String(entry.reversalOfEntry), String(toWip._id), 'linked to the entry whose slice it reverses');
  assert.equal(toWip.status, 'posted', 'the original stays posted (only part of it was reversed)');

  const order = await PurchaseOrder.findById(po._id).lean();
  assert.deepEqual([order.items[0].returnedQuantity, order.grandTotal, order.remainingAmount], [4, 2938, 2938]);
  assert.equal(await stockOf(steel), 5, 'released from the project (+4) and given back (-4)');
  assert.equal((await Vendor.findById(vendor._id)).balance, 2938);
  assert.equal(await balanceOf('suppliers', vendorNumber), -2938, 'the ledger owes the vendor what the order says');
  assert.equal(await balanceOf('wipRaw'), 600, 'PUC holds the 6 bars still on the project');

  // More than is left is refused, and nothing changes.
  await assert.rejects(() => engine.returnPurchaseOrder({ purchaseOrderId: po._id, items: [{ productId: String(steel._id), quantity: 7 }], warehouseId: String(warehouse._id), reason: 'x', idempotencyKey: key(), userId: admin._id }), /Only 6 of "Steel Bar" can still be returned/);
  assert.equal(await JournalEntry.countDocuments({ accountingAction: 'PURCHASE_RETURN' }), 1);

  // The receipt can no longer be reversed in full by hand, nor the return entry.
  await assert.rejects(() => callHandler(reverseJournalEntry, { params: { id: String(toWip._id) }, body: { reversalDate: new Date() } }), /already reversed by a return/);
  await assert.rejects(() => callHandler(reverseJournalEntry, { params: { id: String(entry._id) }, body: { reversalDate: new Date() } }), /cannot be reversed by hand|cannot itself be reversed/);
});

test('full purchase return of a paid service with a vendor refund: service PUC reversed, refund posted, vendor and ledger settle to zero', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  // Pay the order in full (2,938).
  await callHandler(createPurchasePayment, { body: { warehouseId: String(warehouse._id), purchaseOrderId: String(po._id), amountPaid: 2938, paymentAccount: String(A.bank._id) } });
  // A non-cash refund account is refused and the whole return rolls back.
  await assert.rejects(() => engine.returnPurchaseOrder({ purchaseOrderId: po._id, items: [{ productId: String(design._id), quantity: 1 }], refund: { paymentAccount: String(A.sales._id) }, warehouseId: String(warehouse._id), reason: 'x', idempotencyKey: key(), userId: admin._id }), /Cash or Cash Equivalent/);
  assert.equal((await PurchaseOrder.findById(po._id).lean()).items[1].returnedQuantity, 0, 'rolled back: nothing returned');
  assert.equal(await AccountingReversal.countDocuments({ purchaseOrder: po._id }), 1);

  // Return the design service: net 2,000, VAT 280, withholding 20 -> 2,260; refund 2,260.
  const { reversal } = await engine.returnPurchaseOrder({ purchaseOrderId: po._id, items: [{ productId: String(design._id), quantity: 1 }], refund: { paymentAccount: String(A.bank._id) }, warehouseId: String(warehouse._id), reason: 'Design cancelled', idempotencyKey: key(), userId: admin._id });
  assert.deepEqual([reversal.amount, reversal.refundAmount], [2260, 2260]);
  const entries = await JournalEntry.find({ _id: { $in: reversal.reversalEntries } }).sort({ entryNumber: 1 }).lean();
  entries.forEach(balanced);
  assert.deepEqual(linesOf(entries[0]), [['inputVat', 0, 280], ['suppliers', 2260, 0], ['whtPayable', 20, 0], ['wipDesign', 0, 2000]]);
  assert.equal(entries[1].accountingAction, 'PO_REFUND_RECORDED');
  assert.deepEqual(linesOf(entries[1]), [['bank', 2260, 0], ['suppliers', 0, 2260]]);
  const vendorNumber = (await Vendor.findById(vendor._id)).vendorNumber;
  assert.equal(await balanceOf('suppliers', vendorNumber), 0, 'paid 2,938 for 678 of goods, 2,260 refunded');
  assert.equal(await balanceOf('wipDesign'), 0);
  assert.equal(await balanceOf('inputVat'), 84, 'VAT left: 14% of the 600 kept');
  assert.equal(await balanceOf('whtPayable'), -6, 'withholding left: 1% of the 600 kept');
  const order = await PurchaseOrder.findById(po._id).lean();
  assert.deepEqual([order.grandTotal, order.paidAmount, order.paymentStatus], [678, 678, 'paid']);
  assert.equal((await Vendor.findById(vendor._id)).balance, 0);
});

// ============================================================ sales returns
let so;
test('partial sales return: revenue, VAT, receivable and cost are de-recognized for the returned part; stock returns; refund of the excess', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  // 10 panels at 2,000 = 20,000 + VAT 14% 2,800 = 22,800. Executed 20% of 100,000: revenue 20,000,
  // VAT 2,800, receivable 22,800; cost 20% of 40,000 = 8,000 from PUC to cost of sales.
  so = await createSalesOrder({ customer: customer._id, warehouse: String(warehouse._id), project: project._id, vatPercentage: 14, items: [{ product: panel._id, unitPrice: 2000, starterQuantity: 10 }], createdBy: admin._id, employee: admin._id });
  assert.equal(await stockOf(panel), 90);
  const customerNumber = (await User.findById(customer._id)).customerNumber;
  assert.deepEqual([await balanceOf('revenue'), await balanceOf('vat'), await balanceOf('ar', customerNumber), await balanceOf('cogsRaw')], [-20000, -2800, 22800, 8000]);
  // The customer pays in full.
  await callHandler(createSalesPayment, { body: { warehouseId: String(warehouse._id), salesOrderId: String(so._id), amountPaid: 22800, paymentAccount: String(A.bank._id) } });
  assert.equal(await balanceOf('ar', customerNumber), 0);

  // Return 4 panels (8,000 + VAT 1,120 = 9,120) and refund the 9,120 now paid in excess.
  const { reversal } = await engine.returnSalesOrder({ salesOrderId: so._id, items: [{ productId: String(panel._id), quantity: 4 }], warehouseId: String(warehouse._id), refund: { paymentAccount: String(A.bank._id) }, reason: 'Cracked panels', idempotencyKey: key(), userId: admin._id });
  assert.deepEqual([reversal.scope, reversal.amount, reversal.refundAmount], ['partial', 9120, 9120]);
  const entries = await JournalEntry.find({ _id: { $in: reversal.reversalEntries } }).lean();
  entries.forEach(balanced);
  const revenueReversal = entries.find(e => e.accountingAction === 'PROJECT_REVENUE_RECOGNITION');
  assert.deepEqual(linesOf(revenueReversal), [['ar', 0, 9120], ['revenue', 8000, 0], ['vat', 1120, 0]]);
  const costReversal = entries.find(e => e.accountingAction === 'PROJECT_COST_RECOGNITION');
  assert.deepEqual(linesOf(costReversal), [['cogsRaw', 0, 3200], ['wipRaw', 3200, 0]]);
  const refund = entries.find(e => e.accountingAction === 'SO_REFUND_RECORDED');
  assert.deepEqual(linesOf(refund), [['ar', 9120, 0], ['bank', 0, 9120]]);
  assert.equal(refund.lines.find(l => String(l.account?._id || l.account) === String(A.ar._id)).partyNumber, customerNumber);

  assert.deepEqual([await balanceOf('revenue'), await balanceOf('vat'), await balanceOf('ar', customerNumber), await balanceOf('cogsRaw')], [-12000, -1680, 0, 4800]);
  const order = await SalesOrder.findById(so._id).lean();
  assert.deepEqual([order.grandTotal, order.paidAmount, order.paymentStatus], [13680, 13680, 'paid']);
  assert.equal((await Project.findById(project._id).lean()).executedPercentage, 12);
  assert.equal(await stockOf(panel), 94, 'the 4 panels are back in stock');
  assert.equal((await User.findById(customer._id)).balance, 0);
  assert.equal(reversal.returnRecords.length, 1);
});

test('a returned service creates no stock movement; a full return reverses the rest; returning more is refused', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  // Consulting 2 x 1,000 on the same project (no VAT): executed +2%.
  const service = await createSalesOrder({ customer: customer._id, warehouse: String(warehouse._id), project: project._id, items: [{ product: consulting._id, unitPrice: 1000, starterQuantity: 2 }], createdBy: admin._id, employee: admin._id });
  const { reversal } = await engine.returnSalesOrder({ salesOrderId: service._id, items: [{ productId: String(consulting._id), quantity: 2 }], reason: 'Not delivered', idempotencyKey: key(), userId: admin._id });
  assert.equal(reversal.scope, 'full');
  assert.equal((await Product.findById(consulting._id).lean()).stock?.length || 0, 0, 'no stock for a service');
  assert.equal((await Project.findById(project._id).lean()).executedPercentage, 12);
  await assert.rejects(() => engine.returnSalesOrder({ salesOrderId: service._id, items: [{ productId: String(consulting._id), quantity: 1 }], reason: 'x', idempotencyKey: key(), userId: admin._id }), /Only 0 of/);
  // The remaining 6 panels: a full return of the panel order.
  const all = await engine.returnSalesOrder({ salesOrderId: so._id, items: [{ productId: String(panel._id), quantity: 6 }], warehouseId: String(warehouse._id), reason: 'Project cancelled', idempotencyKey: key(), userId: admin._id });
  assert.equal(all.reversal.scope, 'full');
  assert.deepEqual([await balanceOf('revenue'), await balanceOf('vat'), await balanceOf('cogsRaw'), await balanceOf('wipRaw')], [0, 0, 0, 600], 'all revenue, VAT and recognized cost reversed (PUC keeps the purchased 600)');
  assert.ok(all.reversal.notes.some(n => /13680 remains paid in excess/.test(n)), 'unrefunded excess is reported as the customer credit');
  const customerNumber = (await User.findById(customer._id)).customerNumber;
  assert.equal(await balanceOf('ar', customerNumber), -13680, 'the customer credit sits in receivables');
});

// ============================================================ payments
test('customer receipt reversal restores the receivable and outstanding amount, not the invoice; a second reversal is refused', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  // Invoice 5 panels = 10,000 + VAT 1,400 = 11,400; the customer pays 4,000.
  const order = await createSalesOrder({ customer: customer._id, warehouse: String(warehouse._id), project: project._id, vatPercentage: 14, items: [{ product: panel._id, unitPrice: 2000, starterQuantity: 5 }], createdBy: admin._id, employee: admin._id });
  const paid = await callHandler(createSalesPayment, { body: { warehouseId: String(warehouse._id), salesOrderId: String(order._id), amountPaid: 4000, paymentAccount: String(A.bank._id) } });
  const paymentId = paid.body.data.payment._id;
  const customerNumber = (await User.findById(customer._id)).customerNumber;
  const arBefore = await balanceOf('ar', customerNumber);
  const bankBefore = await balanceOf('bank');
  const warehouseBefore = (await Warehouse.findById(warehouse._id)).balance;
  const revenueBefore = await balanceOf('revenue');

  const reasonKey = key();
  const { reversal } = await engine.reversePayment({ paymentId, reason: 'Cheque bounced', idempotencyKey: reasonKey, userId: admin._id });
  const [mirror] = await JournalEntry.find({ _id: { $in: reversal.reversalEntries } }).lean();
  balanced(mirror);
  assert.deepEqual(linesOf(mirror), [['ar', 4000, 0], ['bank', 0, 4000]]);
  assert.equal(String(mirror.reversalOfEntry), String(reversal.originalEntries[0]));
  assert.equal((await JournalEntry.findById(reversal.originalEntries[0]).lean()).status, 'reversed', 'original kept, marked reversed');
  assert.equal(await balanceOf('ar', customerNumber), arBefore + 4000);
  assert.equal(await balanceOf('bank'), bankBefore - 4000);
  assert.equal(await balanceOf('revenue'), revenueBefore, 'the invoice itself is not reversed');
  const after = await SalesOrder.findById(order._id).lean();
  assert.deepEqual([after.paidAmount, after.remainingAmount, after.paymentStatus], [0, 11400, 'unpaid']);
  assert.equal((await Warehouse.findById(warehouse._id)).balance, warehouseBefore - 4000);
  const payment = await Payment.collection.findOne({ _id: new mongoose.Types.ObjectId(paymentId) });
  assert.deepEqual([payment.reversalReason, String(payment.reversedByEntry)], ['Cheque bounced', String(mirror._id)]);

  // The same request again: the first result, nothing new. A new request: refused.
  const replay = await engine.reversePayment({ paymentId, reason: 'Cheque bounced', idempotencyKey: reasonKey, userId: admin._id });
  assert.equal(replay.replayed, true);
  await assert.rejects(() => engine.reversePayment({ paymentId, reason: 'again', idempotencyKey: key(), userId: admin._id }), /already been reversed/);
  assert.equal(await JournalEntry.countDocuments({ reversalOfEntry: reversal.originalEntries[0] }), 1);
});

test('vendor payment reversal; concurrent requests with one key reverse once; Journal Entries -> Reverse of a customer payment updates the order too', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  const res = await callHandler(createPO, { body: { vendorId: String(vendor._id), warehouseId: String(warehouse._id), project: String(project._id), items: [{ productId: steel._id, unitPrice: 100, starterQuantity: 3 }] } });
  const paid = await callHandler(createPurchasePayment, { body: { warehouseId: String(warehouse._id), purchaseOrderId: String(res.body.data._id), amountPaid: 300, paymentAccount: String(A.bank._id) } });
  const k = key();
  const results = await Promise.allSettled([1, 2, 3].map(() => engine.reversePayment({ paymentId: paid.body.data.payment._id, reason: 'Wrong vendor', idempotencyKey: k, userId: admin._id })));
  assert.ok(results.every(r => r.status === 'fulfilled'), JSON.stringify(results.map(r => r.reason?.message)));
  assert.equal(new Set(results.map(r => String(r.value.reversal._id))).size, 1, 'one reversal');
  assert.equal(await JournalEntry.countDocuments({ reversalOfEntry: results[0].value.reversal.originalEntries[0] }), 1, 'one mirror entry');
  const order = await PurchaseOrder.findById(res.body.data._id).lean();
  assert.deepEqual([order.paidAmount, order.remainingAmount], [0, 300]);

  // A customer payment reversed from the Journal Entries page: the order is outstanding again.
  const sale = await createSalesOrder({ customer: customer._id, warehouse: String(warehouse._id), project: project._id, items: [{ product: panel._id, unitPrice: 2000, starterQuantity: 1 }], createdBy: admin._id, employee: admin._id });
  const receipt = await callHandler(createSalesPayment, { body: { warehouseId: String(warehouse._id), salesOrderId: String(sale._id), amountPaid: 2000, paymentAccount: String(A.bank._id) } });
  const entry = await JournalEntry.findOne({ sourceType: 'PAYMENT', sourceId: new mongoose.Types.ObjectId(receipt.body.data.payment._id) });
  await callHandler(reverseJournalEntry, { params: { id: String(entry._id) }, body: { reversalDate: new Date() } });
  assert.deepEqual([(await SalesOrder.findById(sale._id).lean()).paidAmount, (await SalesOrder.findById(sale._id).lean()).paymentStatus], [0, 'unpaid']);
  await assert.rejects(() => engine.reversePayment({ paymentId: receipt.body.data.payment._id, reason: 'x', idempotencyKey: key(), userId: admin._id }), /already been reversed/);
});

// ============================================================ settlements (advance applications)
test('settlement reversal of an advance applied at order creation: the advance gets the amount back, the order is outstanding, the advance receipt stays', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  // Customer advance 2,000 received into the bank, applied to a 1-panel order (2,000) on creation.
  const advance = (await callHandler(createAdvancedPayment, { body: { type: 'customer', customer: String(customer._id), project: String(project._id), amount: 2000, paymentAccount: String(A.bank._id) } })).body.data;
  const order = await createSalesOrder({ customer: customer._id, warehouse: String(warehouse._id), project: project._id, paymentMethod: 'advanced_payment', items: [{ product: panel._id, unitPrice: 2000, starterQuantity: 1 }], createdBy: admin._id, employee: admin._id });
  assert.equal((await AdvancedPayment.findById(advance._id).lean()).remainingAmount, 0);
  const customerNumber = (await User.findById(customer._id)).customerNumber;
  const arBefore = await balanceOf('ar', customerNumber);
  const advancesBefore = await balanceOf('custAdv');

  const k = key();
  const { reversal } = await engine.reverseSettlement({ advancedPaymentId: advance._id, salesOrderId: String(order._id), reason: 'Applied to the wrong order', idempotencyKey: k, userId: admin._id });
  assert.deepEqual([reversal.type, reversal.amount], ['settlement', 2000]);
  const [mirror] = await JournalEntry.find({ _id: { $in: reversal.reversalEntries } }).lean();
  balanced(mirror);
  assert.deepEqual(linesOf(mirror), [['ar', 2000, 0], ['custAdv', 0, 2000]]);
  assert.equal(await balanceOf('ar', customerNumber), arBefore + 2000, 'the order is owed again');
  assert.equal(await balanceOf('custAdv'), advancesBefore - 2000, 'the advance is available again (a liability to the customer)');
  const restored = await AdvancedPayment.findById(advance._id).lean();
  assert.deepEqual([restored.remainingAmount, restored.status, restored.usageHistory[0].reversed], [2000, 'available', true]);
  assert.equal((await JournalEntry.findOne({ advancedPayment: advance._id, accountingAction: 'ADVANCE_PAYMENT_RECEIVED_CUSTOMER' }).lean()).status, 'posted', 'the advance receipt itself is untouched');
  const after = await SalesOrder.findById(order._id).lean();
  assert.deepEqual([after.paidAmount, after.paymentStatus], [0, 'unpaid']);
  // Again: replayed with the key, refused without it - never restored twice.
  assert.equal((await engine.reverseSettlement({ advancedPaymentId: advance._id, salesOrderId: String(order._id), reason: 'x', idempotencyKey: k, userId: admin._id })).replayed, true);
  await assert.rejects(() => engine.reverseSettlement({ advancedPaymentId: advance._id, salesOrderId: String(order._id), reason: 'x', idempotencyKey: key(), userId: admin._id }), /already/);
  assert.equal((await AdvancedPayment.findById(advance._id).lean()).remainingAmount, 2000);
  // Leave it used up so later orders draw on their own advances.
  await AdvancedPayment.updateOne({ _id: advance._id }, { $set: { remainingAmount: 0, status: 'fully_used' } });
});

test('settlement reversal through a payment (vendor advance): only that application is undone; it cannot be reversed as a plain payment', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  // Vendor advance 1,000 paid from the bank; a 5-bar order (500) paid 300 from it.
  const advance = (await callHandler(createAdvancedPayment, { body: { type: 'vendor', vendor: String(vendor._id), project: String(project._id), amount: 1000, paymentAccount: String(A.bank._id) } })).body.data;
  const res = await callHandler(createPO, { body: { vendorId: String(vendor._id), warehouseId: String(warehouse._id), project: String(project._id), items: [{ productId: steel._id, unitPrice: 100, starterQuantity: 5 }] } });
  const paid = await callHandler(createPurchasePayment, { body: { warehouseId: String(warehouse._id), purchaseOrderId: String(res.body.data._id), amountPaid: 300, useAdvancedPayment: true } });
  const paymentId = paid.body.data.payment._id;
  assert.equal((await AdvancedPayment.findById(advance._id).lean()).remainingAmount, 700);
  await assert.rejects(() => engine.reversePayment({ paymentId, reason: 'x', idempotencyKey: key(), userId: admin._id }), /reverse it as a settlement/);

  const { reversal } = await engine.reverseSettlement({ advancedPaymentId: advance._id, paymentId, reason: 'Advance applied twice', idempotencyKey: key(), userId: admin._id });
  const [mirror] = await JournalEntry.find({ _id: { $in: reversal.reversalEntries } }).lean();
  assert.deepEqual(linesOf(mirror), [['supAdv', 300, 0], ['suppliers', 0, 300]]);
  assert.equal((await AdvancedPayment.findById(advance._id).lean()).remainingAmount, 1000);
  const order = await PurchaseOrder.findById(res.body.data._id).lean();
  assert.deepEqual([order.paidAmount, order.remainingAmount], [0, 500]);
  assert.equal((await JournalEntry.findOne({ advancedPayment: advance._id, accountingAction: 'ADVANCE_PAYMENT_PAID_VENDOR' }).lean()).status, 'posted');
});

test('cancelling a sales order paid from an advance also reverses the entry that applied it', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  const advance = (await callHandler(createAdvancedPayment, { body: { type: 'customer', customer: String(customer._id), project: String(project._id), amount: 2000, paymentAccount: String(A.bank._id) } })).body.data;
  const order = await createSalesOrder({ customer: customer._id, warehouse: String(warehouse._id), project: project._id, paymentMethod: 'advanced_payment', items: [{ product: panel._id, unitPrice: 2000, starterQuantity: 1 }], createdBy: admin._id, employee: admin._id });
  const applied = await JournalEntry.findOne({ sourceType: 'SO', sourceId: order._id, accountingAction: 'SO_CUSTOMER_ADVANCE_APPLIED' }).lean();
  assert.equal(String(applied.advancedPayment), String(advance._id));
  await callHandler(cancelOrder, { params: { id: String(order._id) } });
  assert.equal((await JournalEntry.findById(applied._id).lean()).status, 'reversed');
  assert.equal((await AdvancedPayment.findById(advance._id).lean()).remainingAmount, 2000);
});

// ============================================================ whole-ledger checks and access
test('the ledger stays balanced; every reversal is traceable; reversal routes need sign-in and the document permission', async () => {
  const tb = await getTrialBalance();
  assert.equal(Math.round(tb.reduce((s, r) => s + r.balance, 0) * 100), 0, 'trial balance nets to zero');
  const records = await AccountingReversal.find({}).lean();
  assert.ok(records.length >= 8, `${records.length} reversals`);
  for (const r of records) {
    assert.ok(r.reason && r.createdBy && r.date && r.idempotencyKey, 'reason, user, date and key recorded');
    for (const e of await JournalEntry.find({ _id: { $in: r.reversalEntries } }).lean()) balanced(e);
  }
  const history = await engine.listReversals({ salesOrder: String(so._id) });
  assert.equal(history.length, 2);
  assert.ok(history[0].reversalEntries[0].entryNumber > 0, 'entry numbers for the UI');

  const router = require('../../routes/accounting/reversalRoute');
  const authController = require('../../controller/user/authController');
  assert.equal(router.stack[0].handle, authController.protect, 'every route requires sign-in');
  const guardOf = (path, method) => router.stack.find(l => l.route?.path === path).route.stack.find(l => l.method === method).handle;
  const run = (guard, user) => new Promise(resolve => guard({ user }, {}, err => resolve(err ? err.statusCode : 'next')));
  const clerk = { role: 'moderator', permissions: [{ resource: 'salesOrders', actions: ['read'] }] };
  for (const [path, method] of [['/sales-orders/:id/returns', 'post'], ['/purchase-orders/:id/returns', 'post'], ['/payments/:id', 'post'], ['/advanced-payments/:id/settlements', 'post']]) {
    assert.equal(await run(guardOf(path, method), clerk), 403, `${method} ${path} refused without the update permission`);
  }
  await assert.rejects(() => engine.returnSalesOrder({ salesOrderId: so._id, items: [{ productId: String(panel._id), quantity: 1 }], reason: '  ', idempotencyKey: key(), userId: admin._id }), /reason is required/);
});
