const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Covers the new functionality added to SalesOrder/PurchaseOrder/Payment in this phase: VAT,
// Withholding Tax, grandTotal, and Chart-of-Accounts-based payment methods. Tests the models
// directly (mirroring journalEntry.test.js/generalLedger.test.js's convention) rather than going
// through createSalesOrder/createPO's stock-mutating service layer, which is unrelated to what's
// being verified here - the model's own pre('save') hook never touches stock.

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_order_tax_payment';

let SalesOrder;
let PurchaseOrder;
let Payment;
let Product;
let Warehouse;
let Vendor;
let User;
let ChartOfAccount;
let Project;

let customer, vendor, warehouse, product, manager, project;
let cashAccount; // type asset, state cash-equivalent - eligible
let revenueAccount; // ineligible - wrong type

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();

  User = require('../../models/userModel');
  // Warehouse must be required before Payment: warehouseModel.js and paymentModel.js have a
  // pre-existing circular require (warehouseModel's pre('save') hook calls the top-level `Payment`
  // it imports; paymentModel.js separately imports Warehouse too). Requiring Payment first leaves
  // warehouseModel.js's `Payment` binding permanently stuck on the other module's not-yet-finished
  // exports, so warehouseModel.js's own save hook fails with "Payment.find is not a function" the
  // first time anything actually calls `Warehouse.create()` in that require order - unrelated to
  // this phase's changes, just newly exposed because this is the first test file to do so outside
  // a skipped (local-transactions-unavailable) test.
  Warehouse = require('../../models/inventory/warehouseModel');
  SalesOrder = require('../../models/sales/salesOrderModel');
  PurchaseOrder = require('../../models/vendor/purchaseOrder');
  Payment = require('../../models/vendor/paymentModel');
  Product = require('../../models/inventory/productModel');
  Vendor = require('../../models/vendor/vendor');
  ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
  Project = require('../../models/project/projectModel');

  await Promise.all([SalesOrder.init(), PurchaseOrder.init(), Payment.init(), ChartOfAccount.init(), Project.init()]);
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  await Promise.all([
    SalesOrder.deleteMany({}),
    PurchaseOrder.deleteMany({}),
    Payment.deleteMany({}),
    Product.deleteMany({}),
    Warehouse.deleteMany({}),
    Vendor.deleteMany({}),
    User.deleteMany({}),
    ChartOfAccount.deleteMany({}),
    Project.deleteMany({}),
  ]);

  customer = await User.create({ name: 'Tax Test Customer', email: `tax-customer-${Date.now()}@example.com`, role: 'user', type: 'online' });
  manager = await User.create({ name: 'Tax Test Manager', email: `tax-manager-${Date.now()}@example.com`, role: 'admin', type: 'online' });
  vendor = await Vendor.create({ name: 'Tax Test Vendor', contact: { phone: `010${Date.now()}`.slice(0, 11) } });
  warehouse = await Warehouse.create({ name: 'Tax Test Warehouse', location: 'Cairo' });
  product = await Product.create({ type: 'service', title: { en: 'Tax Test Service', ar: 'خدمة اختبار' }, description: { en: 'd', ar: 'د' }, price: 100, durationValue: 1, durationUnit: 'month' });
  project = await Project.create({
    projectNumber: `TAX-PRJ-${Date.now()}`,
    projectManager: manager._id,
    startDate: new Date(),
    deliveryDate: new Date(Date.now() + 86400000),
  });
  cashAccount = await ChartOfAccount.create({ code: `CASH-${Date.now()}`, name: 'Main Cash', type: 'asset', state: 'cash' });
  revenueAccount = await ChartOfAccount.create({ code: `REV-${Date.now()}`, name: 'Revenue', type: 'revenue' });
});

// ===================== VAT / Withholding Tax =====================

test('SalesOrder: VAT only (100,000 @ 14%, no withholding) -> VAT 14,000, grandTotal 114,000', async () => {
  const order = await SalesOrder.create({
    customer: customer._id,
    warehouse: warehouse._id,
    project: project._id,
    orderSource: 'cashier',
    employee: manager._id,
    vatPercentage: 14,
    items: [{ product: product._id, unitPrice: 100000, starterQuantity: 1 }],
  });

  assert.equal(order.totalAmount, 100000);
  assert.equal(order.vatAmount, 14000);
  assert.equal(order.withholdingTaxAmount, 0);
  assert.equal(order.grandTotal, 114000);
});

test('SalesOrder: VAT + Withholding Tax (100,000 @ 14% VAT, 1% withholding) -> grandTotal 113,000', async () => {
  const order = await SalesOrder.create({
    customer: customer._id,
    warehouse: warehouse._id,
    project: project._id,
    orderSource: 'cashier',
    employee: manager._id,
    vatPercentage: 14,
    withholdingTaxPercentage: 1,
    items: [{ product: product._id, unitPrice: 100000, starterQuantity: 1 }],
  });

  assert.equal(order.vatAmount, 14000);
  assert.equal(order.withholdingTaxAmount, 1000);
  assert.equal(order.grandTotal, 113000);
});

test('PurchaseOrder: VAT + Withholding Tax (250,000 @ 14% VAT, 3% withholding) -> grandTotal 277,500', async () => {
  const order = await PurchaseOrder.create({
    vendorId: vendor._id,
    warehouseId: warehouse._id,
    project: project._id,
    vatPercentage: 14,
    withholdingTaxPercentage: 3,
    items: [{ productId: product._id, unitPrice: 250000, starterQuantity: 1 }],
  });

  assert.equal(order.totalAmount, 250000);
  assert.equal(order.vatAmount, 35000);
  assert.equal(order.withholdingTaxAmount, 7500);
  assert.equal(order.grandTotal, 277500);
  assert.equal(order.project.toString(), project._id.toString());
});

test('withholdingTaxPercentage rejects any value other than 0, 1, 3, 5', async () => {
  await assert.rejects(
    () =>
      SalesOrder.create({
        customer: customer._id,
        warehouse: warehouse._id,
        project: project._id,
        orderSource: 'cashier',
        employee: manager._id,
        withholdingTaxPercentage: 2,
        items: [{ product: product._id, unitPrice: 1000, starterQuantity: 1 }],
      }),
    /not a valid withholding tax percentage/
  );
});

test('a client cannot manipulate vatAmount/withholdingTaxAmount/grandTotal directly - they are always recomputed from the real item totals', async () => {
  const order = await SalesOrder.create({
    customer: customer._id,
    warehouse: warehouse._id,
    project: project._id,
    orderSource: 'cashier',
    employee: manager._id,
    vatPercentage: 14,
    // Manipulated values a malicious client might send - must be silently overridden.
    vatAmount: 999999,
    withholdingTaxAmount: 999999,
    grandTotal: 1,
    items: [{ product: product._id, unitPrice: 1000, starterQuantity: 1 }],
  });

  assert.equal(order.vatAmount, 140, 'vatAmount must be derived from the real totalAmount, not the submitted value');
  assert.equal(order.withholdingTaxAmount, 0);
  assert.equal(order.grandTotal, 1140, 'grandTotal must be totalAmount + vatAmount - withholdingTaxAmount, not the submitted value');
});

// ===================== Chart-of-Accounts-based payment method =====================

test('SalesOrder: paymentMethod "account" with an eligible Cash account succeeds', async () => {
  const order = await SalesOrder.create({
    customer: customer._id,
    warehouse: warehouse._id,
    project: project._id,
    orderSource: 'cashier',
    employee: manager._id,
    paymentMethod: 'account',
    paymentAccount: cashAccount._id,
    items: [{ product: product._id, unitPrice: 1000, starterQuantity: 1 }],
  });
  assert.equal(order.paymentAccount._id.toString(), cashAccount._id.toString());
});

test('SalesOrder: paymentMethod "account" with a non-Cash/Cash-Equivalent account is rejected', async () => {
  await assert.rejects(
    () =>
      SalesOrder.create({
        customer: customer._id,
        warehouse: warehouse._id,
        project: project._id,
        orderSource: 'cashier',
        employee: manager._id,
        paymentMethod: 'account',
        paymentAccount: revenueAccount._id,
        items: [{ product: product._id, unitPrice: 1000, starterQuantity: 1 }],
      }),
    /must be a Cash or Cash Equivalent account/
  );
});

test('PurchaseOrder: paymentMethod "account" with an eligible Cash account succeeds, ineligible is rejected', async () => {
  const order = await PurchaseOrder.create({
    vendorId: vendor._id,
    warehouseId: warehouse._id,
    project: project._id,
    paymentMethod: 'account',
    paymentAccount: cashAccount._id,
    items: [{ productId: product._id, unitPrice: 500, starterQuantity: 1 }],
  });
  assert.equal(order.paymentAccount._id.toString(), cashAccount._id.toString());

  await assert.rejects(
    () =>
      PurchaseOrder.create({
        vendorId: vendor._id,
        warehouseId: warehouse._id,
        project: project._id,
        paymentMethod: 'account',
        paymentAccount: revenueAccount._id,
        items: [{ productId: product._id, unitPrice: 500, starterQuantity: 1 }],
      }),
    /must be a Cash or Cash Equivalent account/
  );
});

test('PurchaseOrder: "advanced_payment" is now a valid paymentMethod (vendor-side Advanced Payment consumption)', async () => {
  const order = await PurchaseOrder.create({
    vendorId: vendor._id,
    warehouseId: warehouse._id,
    project: project._id,
    paymentMethod: 'advanced_payment',
    items: [{ productId: product._id, unitPrice: 500, starterQuantity: 1 }],
  });
  assert.equal(order.paymentMethod, 'advanced_payment');
  assert.equal(order.paymentAccount, null);
});

test('PurchaseOrder: paymentAccount cannot be set unless paymentMethod is "account"', async () => {
  await assert.rejects(
    () =>
      PurchaseOrder.create({
        vendorId: vendor._id,
        warehouseId: warehouse._id,
        project: project._id,
        paymentMethod: 'advanced_payment',
        paymentAccount: cashAccount._id,
        items: [{ productId: product._id, unitPrice: 500, starterQuantity: 1 }],
      }),
    /paymentAccount can only be set when paymentMethod is "account"/
  );
});

test('PurchaseOrder: advancedPayment cannot be set unless paymentMethod is "advanced_payment"', async () => {
  await assert.rejects(
    () =>
      PurchaseOrder.create({
        vendorId: vendor._id,
        warehouseId: warehouse._id,
        project: project._id,
        paymentMethod: 'account',
        paymentAccount: cashAccount._id,
        advancedPayment: new mongoose.Types.ObjectId(),
        items: [{ productId: product._id, unitPrice: 500, starterQuantity: 1 }],
      }),
    /advancedPayment can only be set when paymentMethod is "advanced_payment"/
  );
});

test('PurchaseOrder: item costAccount must be a "cogs"-type account when set', async () => {
  await assert.rejects(
    () =>
      PurchaseOrder.create({
        vendorId: vendor._id,
        warehouseId: warehouse._id,
        project: project._id,
        items: [{ productId: product._id, unitPrice: 500, starterQuantity: 1, costAccount: cashAccount._id }],
      }),
    /not eligible as an item cost account/
  );
});

test('Payment: requires a paymentMethod, paymentAccount, or advancedPayment', async () => {
  await assert.rejects(
    () =>
      Payment.create({
        warehouseId: warehouse._id,
        vendorId: vendor._id,
        type: 'out',
        amountPaid: 100,
        paymentCategory: 'purchase',
      }),
    /A payment method, payment account, or advanced payment is required/
  );
});

test('Payment: paymentAccount eligibility is enforced (Cash accepted, Revenue rejected)', async () => {
  const payment = await Payment.create({
    warehouseId: warehouse._id,
    vendorId: vendor._id,
    type: 'out',
    amountPaid: 100,
    paymentCategory: 'purchase',
    paymentAccount: cashAccount._id,
  });
  assert.equal(payment.paymentAccount.toString(), cashAccount._id.toString());

  await assert.rejects(
    () =>
      Payment.create({
        warehouseId: warehouse._id,
        vendorId: vendor._id,
        type: 'out',
        amountPaid: 100,
        paymentCategory: 'purchase',
        paymentAccount: revenueAccount._id,
      }),
    /must be a Cash or Cash Equivalent account/
  );
});

test('Payment: cannot be funded from both a paymentAccount and an advancedPayment at once', async () => {
  await assert.rejects(
    () =>
      Payment.create({
        warehouseId: warehouse._id,
        vendorId: vendor._id,
        type: 'out',
        amountPaid: 100,
        paymentCategory: 'purchase',
        paymentAccount: cashAccount._id,
        advancedPayment: new mongoose.Types.ObjectId(),
      }),
    /cannot be funded from both/
  );
});

// ===================== Project is required for new Sales/Purchase Orders =====================

test('SalesOrder: creating a NEW order without a project is rejected (model backstop)', async () => {
  await assert.rejects(
    () =>
      SalesOrder.create({
        customer: customer._id,
        warehouse: warehouse._id,
        orderSource: 'cashier',
        employee: manager._id,
        items: [{ product: product._id, unitPrice: 1000, starterQuantity: 1 }],
      }),
    /A project is required to create a Sales Order/
  );
});

test('SalesOrder: a historical order with no project can still be re-saved (cancel/deliver/return paths are not blocked)', async () => {
  // Bypasses the model's own `isNew` check by inserting directly, the same way real historical
  // data created before this rule existed would look - locks in that `isNew`-scoping (not a plain
  // schema `required: true`) is what prevents this from becoming unreadable/un-resavable.
  const raw = await mongoose.connection.collection('salesorders').insertOne({
    customer: customer._id,
    orderSource: 'cashier',
    items: [{ product: product._id, unitPrice: 1000, starterQuantity: 1, returnedQuantity: 0, itemDiscount: { type: 'fixed', value: 0 } }],
    paidAmount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const legacyOrder = await SalesOrder.findById(raw.insertedId);
  legacyOrder.orderStatus = 'canceled';
  await legacyOrder.save();

  const reloaded = await SalesOrder.findById(raw.insertedId);
  assert.equal(reloaded.orderStatus, 'canceled');
});

test('PurchaseOrder: creating a NEW order without a project is rejected (model backstop)', async () => {
  await assert.rejects(
    () =>
      PurchaseOrder.create({
        vendorId: vendor._id,
        warehouseId: warehouse._id,
        items: [{ productId: product._id, unitPrice: 500, starterQuantity: 1 }],
      }),
    /A project is required to create a Purchase Order/
  );
});

test('PurchaseOrder: a historical order with no project can still be re-saved (e.g. a Payment recording against it)', async () => {
  const raw = await mongoose.connection.collection('purchaseorders').insertOne({
    vendorId: vendor._id,
    warehouseId: warehouse._id,
    items: [{ productId: product._id, unitPrice: 500, starterQuantity: 1, returnedQuantity: 0, itemDiscount: { type: 'fixed', value: 0 } }],
    paidAmount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const legacyOrder = await PurchaseOrder.findById(raw.insertedId);
  legacyOrder.paidAmount += 100;
  await legacyOrder.save();

  const reloaded = await PurchaseOrder.findById(raw.insertedId);
  assert.equal(reloaded.paidAmount, 100);
});

test('Payment: legacy paymentMethod string (no paymentAccount) still works for backward compatibility', async () => {
  const payment = await Payment.create({
    warehouseId: warehouse._id,
    vendorId: vendor._id,
    type: 'out',
    amountPaid: 100,
    paymentCategory: 'purchase',
    paymentMethod: 'cash',
  });
  assert.equal(payment.paymentMethod, 'cash');
  assert.equal(payment.paymentAccount, null);
});
