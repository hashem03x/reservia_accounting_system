const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Purchase/PUC/Cash Change Request: covers, through the REAL controllers (not the model directly),
// the three changes that touch live accounting -
//   1. Payment Method is no longer accepted at Purchase Invoice creation (it is created unpaid;
//      paying it - by cash/bank OR by consuming a vendor Advanced Payment - happens exclusively
//      through the standalone payment-recording endpoint).
//   2. The Purchase Invoice item quantity cap of 1,000 is removed (large and decimal quantities are
//      accepted, with correct totals/tax).
//   3. Purchased project materials already net OUT of Materials Inventory and land fully in the
//      project's PUC account in the same transaction (verified here, not rebuilt).
// and, as a cross-check for the Cash page (Change Request item 5): that creating/paying a Purchase
// Invoice moves cash/bank balances only when a REAL payment is recorded, never merely on creation.

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_purchase_invoice_puc_cash_cr';
const { AutomaticJournalAccountCodes: C } = require('../../utils/accountingConstants');

let ChartOfAccount, Vendor, User, Warehouse, Project, Product, Requisition, PurchaseOrder, JournalEntry, Payment, AdvancedPayment;
let createPO, createPurchasePayment;
let transactionsSupported = true;
const A = {};
let admin, vendor, warehouse, project, product;

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

async function openRequisitionFor(vendorId, projectId, amount) {
  const requisition = await Requisition.create({ vendorId, project: projectId, items: [{ description: 'Bulk steel', quantity: 1, unitPrice: amount }] });
  requisition.status = 'open';
  await requisition.save();
  return requisition;
}

/** Net posted balance of a ChartOfAccount (debit - credit) across every journal line for it. */
async function netBalance(accountId) {
  const rows = await JournalEntry.aggregate([
    { $match: { status: 'posted' } },
    { $unwind: '$lines' },
    { $match: { 'lines.account': new mongoose.Types.ObjectId(accountId) } },
    { $group: { _id: null, debit: { $sum: '$lines.debit' }, credit: { $sum: '$lines.credit' } } },
  ]);
  if (!rows.length) return 0;
  return Math.round((rows[0].debit - rows[0].credit) * 100) / 100;
}

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();

  User = require('../../models/userModel');
  Warehouse = require('../../models/inventory/warehouseModel');
  Vendor = require('../../models/vendor/vendor');
  ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
  Project = require('../../models/project/projectModel');
  Product = require('../../models/inventory/productModel');
  Requisition = require('../../models/vendor/requisitionModel');
  PurchaseOrder = require('../../models/vendor/purchaseOrder');
  JournalEntry = require('../../models/accounting/journalEntryModel');
  Payment = require('../../models/vendor/paymentModel');
  AdvancedPayment = require('../../models/payments/advancedPaymentModel');
  ({ createPO } = require('../../controller/PO/purchaseOrderController'));
  ({ createPurchasePayment } = require('../../controller/PO/PaymentController'));

  await Promise.all([PurchaseOrder.init(), JournalEntry.init(), ChartOfAccount.init(), Payment.init()]);

  const probe = await mongoose.startSession();
  try {
    await probe.withTransaction(async () => {
      await mongoose.connection.collection('__txn_probe').insertOne({ ok: 1 }, { session: probe });
    });
  } catch {
    transactionsSupported = false;
  } finally {
    probe.endSession();
  }

  const account = (k, code, name, type, extra = {}) => ChartOfAccount.create({ code, name, type, ...extra }).then(a => (A[k] = a));
  await account('bank', 'CASH-1', 'Bank Misr', 'asset', { state: 'cash' });
  await account('suppliers', C.suppliers, 'Suppliers', 'liability');
  await account('advance', C.advanceToSuppliers, 'Advances to Suppliers', 'asset');
  await account('inventory', C.materialsInventory, 'Materials Inventory', 'asset');
  await account('wipRaw', C.wipRawMaterials, 'PUC - Raw Materials', 'asset');
  await account('inputVat', C.inputVat, 'Input VAT', 'asset');
  await account('whtPayable', C.withholdingTaxPayable, 'Withholding Taxes Payable', 'liability');

  admin = await User.create({ name: 'Admin', email: `admin-${Date.now()}@example.com`, role: 'admin', type: 'online' });
  admin.id = String(admin._id);
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  vendor = await Vendor.create({ name: 'Large Qty Vendor', contact: { phone: `010${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(-10) } });
  warehouse = await Warehouse.create({ name: `WH-${unique}`, location: `Cairo-${unique}` });
  project = await Project.create({ projectNumber: `PRJ-${unique}`, name: 'Test Project', startDate: new Date('2026-01-01'), deliveryDate: new Date('2026-12-31') });
  product = await Product.create({ type: 'product', title: { en: `Rebar ${unique}`, ar: `حديد ${unique}` }, description: { en: 'd', ar: 'د' }, price: 10, cost: 5, category: new mongoose.Types.ObjectId(), subcategory: new mongoose.Types.ObjectId() });
});

test('a Purchase Invoice is created unpaid, with no Payment Method accepted, quantities above 1,000 and with decimals both accepted', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');

  // A.inventory/A.wipRaw/A.bank are shared control accounts across every test in this file -
  // compare the CHANGE caused by this test's own invoice, not an absolute total.
  const [inventoryBefore, wipRawBefore, bankBefore] = await Promise.all([netBalance(A.inventory._id), netBalance(A.wipRaw._id), netBalance(A.bank._id)]);
  const requisition = await openRequisitionFor(vendor._id, project._id, 1_000_000);
  const res = await callHandler(createPO, {
    body: {
      vendorId: String(vendor._id),
      warehouseId: String(warehouse._id),
      project: String(project._id),
      requisition: String(requisition._id),
      vatPercentage: 14,
      // Sending a Payment Method is now simply ignored/unsupported - the create path no longer
      // reads it off the request at all. Quantities: one far above the old 1,000 cap, one decimal.
      paymentMethod: 'account',
      paymentAccount: String(A.bank._id),
      items: [
        { productId: product._id, unitPrice: 10, starterQuantity: 10000 },
        { productId: product._id, unitPrice: 10, starterQuantity: 1500.5 },
      ],
    },
  });

  assert.equal(res.status, 201);
  const invoice = res.body.data;
  // Never set from the request body any more - always created unpaid.
  assert.equal(invoice.paymentMethod, null);
  assert.equal(invoice.paymentAccount, null);
  assert.equal(invoice.paidAmount, 0);
  assert.equal(invoice.paymentStatus, 'unpaid');

  // 10,000 x 10 + 1,500.5 x 10 = 115,005; both quantities preserved exactly (no 1,000 cap, decimals kept).
  const items = invoice.items.map(i => i.starterQuantity);
  assert.deepEqual(items, [10000, 1500.5]);
  assert.equal(invoice.totalAmount, 115005);
  assert.equal(invoice.vatAmount, Math.round(115005 * 0.14 * 100) / 100);
  assert.equal(invoice.grandTotal, Math.round((115005 + 115005 * 0.14) * 100) / 100);

  // Materials Inventory nets to zero (received, then immediately moved to the project's PUC in the
  // same transaction) - purchased project materials are already carried by PUC, not Inventory.
  assert.equal(await netBalance(A.inventory._id), inventoryBefore, 'Materials Inventory must net to zero for a project purchase');
  assert.equal((await netBalance(A.wipRaw._id)) - wipRawBefore, 115005, 'PUC - Raw Materials must carry the full purchased cost');

  // Creating the invoice alone - even with a paymentAccount sent in the (now-ignored) request body -
  // must never move any cash/bank balance or create a Payment record (Cash page integration).
  assert.equal(await Payment.countDocuments({ purchaseOrderId: invoice._id }), 0);
  assert.equal(await netBalance(A.bank._id), bankBefore, 'no real payment was recorded, so the bank account must be untouched');
});

test('an unpaid Purchase Invoice can still be paid afterward from a Cash/Bank account, through the standalone payment endpoint', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');

  // A.bank is a shared control account across every test in this file - compare the CHANGE caused
  // by this test's own payment, not an absolute total (earlier/later tests also touch it).
  const bankBefore = await netBalance(A.bank._id);
  const requisition = await openRequisitionFor(vendor._id, project._id, 10000);
  const created = (await callHandler(createPO, {
    body: { vendorId: String(vendor._id), warehouseId: String(warehouse._id), project: String(project._id), requisition: String(requisition._id), items: [{ productId: product._id, unitPrice: 10, starterQuantity: 100 }] },
  })).body.data;
  assert.equal(created.paymentMethod, null, 'created unpaid, as always now');
  assert.equal(await netBalance(A.bank._id), bankBefore, 'creating the invoice alone must not move cash');

  const pay = await callHandler(createPurchasePayment, {
    body: { warehouseId: String(warehouse._id), purchaseOrderId: String(created._id), amountPaid: 1000, paymentAccount: String(A.bank._id), notes: 'Full settlement' },
  });
  assert.equal(pay.status, 201);
  assert.equal(pay.body.data.purchaseOrder.paidAmount, 1000);
  assert.equal(pay.body.data.purchaseOrder.paymentStatus, 'paid');
  assert.equal(await netBalance(A.bank._id), bankBefore - 1000, 'the bank account is credited (cash paid out) only now, by the real payment');
});

test('an unpaid Purchase Invoice can be paid by consuming a vendor Advanced Payment, independently of the invoice\'s own (now-removed) Payment Method', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');

  // A.bank is a shared control account across every test in this file - compare against its
  // balance at the START of this test, not an absolute 0, since earlier tests already moved it.
  const bankBefore = await netBalance(A.bank._id);
  const advance = await AdvancedPayment.create({ type: 'vendor', vendor: vendor._id, project: project._id, amount: 5000, paymentAccount: A.bank._id, createdBy: admin._id });
  const requisition = await openRequisitionFor(vendor._id, project._id, 10000);
  const created = (await callHandler(createPO, {
    body: { vendorId: String(vendor._id), warehouseId: String(warehouse._id), project: String(project._id), requisition: String(requisition._id), items: [{ productId: product._id, unitPrice: 10, starterQuantity: 200 }] },
  })).body.data;
  assert.equal(created.paymentMethod, null);
  assert.equal(created.advancedPayment, null, 'the invoice never consumes an advance at creation time any more');

  const pay = await callHandler(createPurchasePayment, {
    body: { warehouseId: String(warehouse._id), purchaseOrderId: String(created._id), amountPaid: 2000, useAdvancedPayment: true },
  });
  assert.equal(pay.status, 201);
  assert.equal(pay.body.data.purchaseOrder.paidAmount, 2000);

  const reloadedAdvance = await AdvancedPayment.findById(advance._id);
  assert.equal(reloadedAdvance.remainingAmount, 3000, 'the vendor Advanced Payment is still fully usable, drawn down by the standalone payment flow');
  assert.equal(await netBalance(A.bank._id), bankBefore, 'consuming an Advanced Payment is not a new cash movement - creating the AdvancedPayment itself (a separate, already-tested feature) is the only thing that could move cash here, and this test never touches it again after that');
});

test('request-shape validation accepts any positive quantity (1,500, 10,000, decimals) and rejects zero/negative/non-numeric - no 1,000 cap', async () => {
  const { validationResult } = require('express-validator');
  const { createPurchaseOrderValidate } = require('../../utils/validators/poValidator');
  const errorsFor = async starterQuantity => {
    const req = { body: { items: [{ productId: String(product._id), unitPrice: 10, starterQuantity }] }, params: {}, query: {} };
    for (const v of createPurchaseOrderValidate) if (typeof v.run === 'function') await v.run(req);
    return validationResult(req).array().filter(e => /items\[0\]\.starterQuantity/.test(e.param)).map(e => e.msg);
  };
  for (const ok of [1, 1000, 1500, 10000, 50000, 2.5]) assert.deepEqual(await errorsFor(ok), [], `quantity ${ok} should be accepted`);
  for (const bad of [0, -1, 'abc', '']) assert.ok((await errorsFor(bad)).length > 0, `quantity ${JSON.stringify(bad)} should be rejected`);
});
