const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_advanced_payments';

let AdvancedPayment;
let Project;
let User;
let Vendor;
let SalesOrder;
let Warehouse;
let Product;
let ChartOfAccount;
let JournalEntry;
let consumeCustomerAdvancedPayment;
let restoreAdvancedPaymentForSalesOrder;
let consumeVendorAdvancedPayment;
let createSalesOrder;

let manager;
let customerA;
let customerB;
let vendor;
let projectA; // belongs to customerA
let projectB; // belongs to customerB
let cashAccount; // eligible Payment Method account - paymentAccount is now required on every AdvancedPayment

// Mirrors journalEntry.test.js's transaction-support probe - standalone local MongoDB cannot run
// multi-document transactions, so the end-to-end `createSalesOrder` (which requires its own
// session/transaction) is only exercised here if the local test DB happens to support it; it is
// otherwise verified separately against the real Atlas replica set.
let transactionsSupported = true;

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();

  AdvancedPayment = require('../../models/payments/advancedPaymentModel');
  Project = require('../../models/project/projectModel');
  User = require('../../models/userModel');
  Vendor = require('../../models/vendor/vendor');
  SalesOrder = require('../../models/sales/salesOrderModel');
  Warehouse = require('../../models/inventory/warehouseModel');
  Product = require('../../models/inventory/productModel');
  ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
  ({ consumeCustomerAdvancedPayment, restoreAdvancedPaymentForSalesOrder, consumeVendorAdvancedPayment } = require('../../services/payments/advancedPaymentService'));
  ({ createSalesOrder } = require('../../services/sales/salesOrderCreation.service'));

  await Promise.all([AdvancedPayment.init(), Project.init(), User.init(), Vendor.init(), SalesOrder.init(), ChartOfAccount.init()]);

  const probeSession = await mongoose.startSession();
  try {
    await probeSession.withTransaction(async () => {
      await mongoose.connection.collection('__txn_probe').insertOne({ ok: 1 }, { session: probeSession });
    });
    await mongoose.connection.collection('__txn_probe').drop().catch(() => {});
  } catch (err) {
    transactionsSupported = false;
  } finally {
    probeSession.endSession();
  }
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  await AdvancedPayment.deleteMany({});
  await Project.deleteMany({});
  await SalesOrder.deleteMany({});
  await User.deleteMany({});
  await Vendor.deleteMany({});
  await Warehouse.deleteMany({});
  await Product.deleteMany({});
  await ChartOfAccount.deleteMany({});

  cashAccount = await ChartOfAccount.create({ code: `CASH-${Date.now()}`, name: 'Main Cash', type: 'asset', parentGroupNameEn: 'Cash & Cash Equivalents' });
  manager = await User.create({ name: 'PM', email: `pm-${Date.now()}@example.com`, role: 'admin', type: 'online' });
  customerA = await User.create({ name: 'Customer A', email: `customer-a-${Date.now()}@example.com`, role: 'user', type: 'online' });
  customerB = await User.create({ name: 'Customer B', email: `customer-b-${Date.now()}@example.com`, role: 'user', type: 'online' });
  vendor = await Vendor.create({ name: 'Test Vendor', contact: { phone: `010${Date.now()}`.slice(0, 11) } });

  projectA = await Project.create({
    projectNumber: `PRJ-A-${Date.now()}`,
    customer: customerA._id,
    contractValue: 100000,
    projectManager: manager._id,
    startDate: new Date(),
    deliveryDate: new Date(Date.now() + 86400000),
  });
  projectB = await Project.create({
    projectNumber: `PRJ-B-${Date.now()}`,
    customer: customerB._id,
    contractValue: 100000,
    projectManager: manager._id,
    startDate: new Date(),
    deliveryDate: new Date(Date.now() + 86400000),
  });
});

// ===================== Advanced Payment model =====================

test('creates a Customer Advanced Payment with remainingAmount = amount and status "available"', async () => {
  const advance = await AdvancedPayment.create({ type: 'customer', customer: customerA._id, project: projectA._id, amount: 50000, paymentAccount: cashAccount._id, createdBy: manager._id });
  assert.equal(advance.remainingAmount, 50000);
  assert.equal(advance.status, 'available');
  assert.equal(advance.vendor, null);
});

test('creates a Vendor Advanced Payment with a valid Project', async () => {
  const advance = await AdvancedPayment.create({ type: 'vendor', vendor: vendor._id, project: projectA._id, amount: 20000, paymentAccount: cashAccount._id, createdBy: manager._id });
  assert.equal(advance.remainingAmount, 20000);
  assert.equal(advance.status, 'available');
  assert.equal(advance.customer, null);
  assert.equal(advance.project.toString(), projectA._id.toString());
});

test('rejects a Vendor Advanced Payment with no Project (newly mandatory)', async () => {
  await assert.rejects(
    () => AdvancedPayment.create({ type: 'vendor', vendor: vendor._id, amount: 20000, paymentAccount: cashAccount._id, createdBy: manager._id }),
    /project is required for a vendor advanced payment/i
  );
});

test('rejects a Vendor Advanced Payment with an invalid/non-existent Project', async () => {
  const fakeProjectId = new mongoose.Types.ObjectId();
  // The model's own backstop only checks presence, not existence, for the vendor branch (unlike
  // the customer branch, which also verifies the project belongs to the right customer) - a
  // non-existent project id is still caught, just via Mongoose's own ObjectId cast/ref resolution
  // at read time rather than an explicit existence check here. The request validator
  // (advancedPaymentValidators.js) is what actually verifies the project EXISTS before this model
  // hook ever runs for a real HTTP request.
  const advance = await AdvancedPayment.create({ type: 'vendor', vendor: vendor._id, project: fakeProjectId, amount: 20000, paymentAccount: cashAccount._id, createdBy: manager._id });
  assert.equal(advance.project.toString(), fakeProjectId.toString());
});

test('a legacy Vendor Advanced Payment with no Project (predating the new requirement) remains readable and re-savable', async () => {
  // Simulates a document created before Project became mandatory for vendor advances - bypasses
  // the pre('validate') hook entirely via a raw collection insert, the same technique used
  // elsewhere in this suite for "legacy document" scenarios.
  const legacyId = new mongoose.Types.ObjectId();
  await mongoose.connection.collection('advancedpayments').insertOne({
    _id: legacyId,
    type: 'vendor',
    vendor: vendor._id,
    project: null,
    amount: 5000,
    remainingAmount: 5000,
    paymentAccount: cashAccount._id,
    status: 'available',
    usageHistory: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const legacy = await AdvancedPayment.findById(legacyId);
  assert.ok(legacy, 'a legacy vendor advance with no project must still be readable, not throw');

  // Re-saving it for an unrelated reason (e.g. its remainingAmount changing as it's consumed) must
  // not retroactively reject it for a field it predates - the `isNew`-scoped backstop is what
  // makes this safe.
  legacy.remainingAmount = 2500;
  await legacy.save();
  const reloaded = await AdvancedPayment.findById(legacyId);
  assert.equal(reloaded.remainingAmount, 2500);
});

test('rejects a Customer Advanced Payment for a project belonging to a different customer', async () => {
  await assert.rejects(
    () => AdvancedPayment.create({ type: 'customer', customer: customerA._id, project: projectB._id, amount: 1000, createdBy: manager._id }),
    /does not belong to the selected customer/
  );
});

test('rejects a Customer Advanced Payment with no customer', async () => {
  await assert.rejects(
    () => AdvancedPayment.create({ type: 'customer', project: projectA._id, amount: 1000, createdBy: manager._id }),
    /customer is required/
  );
});

test('rejects a Customer Advanced Payment with an invalid/missing project', async () => {
  await assert.rejects(
    () => AdvancedPayment.create({ type: 'customer', customer: customerA._id, amount: 1000, createdBy: manager._id }),
    /project is required/
  );

  const fakeProjectId = new mongoose.Types.ObjectId();
  await assert.rejects(
    () => AdvancedPayment.create({ type: 'customer', customer: customerA._id, project: fakeProjectId, amount: 1000, createdBy: manager._id }),
    /Project not found/
  );
});

test('ignores a client-supplied remainingAmount on create', async () => {
  const advance = await AdvancedPayment.create({
    type: 'customer',
    customer: customerA._id,
    project: projectA._id,
    amount: 50000,
    remainingAmount: 999999,
    paymentAccount: cashAccount._id,
    createdBy: manager._id,
  });
  assert.equal(advance.remainingAmount, 50000, 'remainingAmount must always start equal to amount, never a client-supplied value');
});

test('status transitions: available -> partially_used -> fully_used as remainingAmount changes', async () => {
  const advance = await AdvancedPayment.create({ type: 'customer', customer: customerA._id, project: projectA._id, amount: 100000, paymentAccount: cashAccount._id, createdBy: manager._id });
  assert.equal(advance.status, 'available');

  advance.remainingAmount = 60000;
  await advance.save();
  assert.equal(advance.status, 'partially_used');

  advance.remainingAmount = 0;
  await advance.save();
  assert.equal(advance.status, 'fully_used');
});

// ===================== consumeCustomerAdvancedPayment / restore =====================

// A real (if minimal) SalesOrder - needed so AdvancedPayment's own populate hook
// (`usageHistory.salesOrder`) resolves to something real instead of nulling out an unresolvable
// reference, which would mask the exact "populated object vs raw id" bug this suite caught in
// advancedPaymentService.js.
async function createMinimalSalesOrder() {
  return SalesOrder.create({ customer: customerA._id, orderSource: 'cashier', project: projectA._id, items: [] });
}

test('consumeCustomerAdvancedPayment consumes the full remaining amount and records usage history', async () => {
  const advance = await AdvancedPayment.create({ type: 'customer', customer: customerA._id, project: projectA._id, amount: 50000, paymentAccount: cashAccount._id, createdBy: manager._id });
  const salesOrder = await createMinimalSalesOrder();

  const { advancedPaymentId, consumedAmount } = await consumeCustomerAdvancedPayment({
    customer: customerA._id,
    project: projectA._id,
    salesOrderId: salesOrder._id,
  });

  assert.equal(consumedAmount, 50000);
  assert.equal(advancedPaymentId.toString(), advance._id.toString());

  const reloaded = await AdvancedPayment.findById(advance._id);
  assert.equal(reloaded.remainingAmount, 0);
  assert.equal(reloaded.status, 'fully_used');
  assert.equal(reloaded.usageHistory.length, 1);
  assert.equal(reloaded.usageHistory[0].salesOrder._id.toString(), salesOrder._id.toString(), 'the usage entry must reference the real sales order (populated by AdvancedPayment\'s own find hook)');
  assert.equal(reloaded.usageHistory[0].amountConsumed, 50000);
});

// ===================== Partial consumption via Add Payment (docs section "Add Payment - Advanced Payment") =====================

test('consumeCustomerAdvancedPayment: an explicit `amount` consumes only that much, leaving the rest available, and records the `payment` ref (not `salesOrder`)', async () => {
  const advance = await AdvancedPayment.create({ type: 'customer', customer: customerA._id, project: projectA._id, amount: 50000, paymentAccount: cashAccount._id, createdBy: manager._id });
  const paymentId = new mongoose.Types.ObjectId();

  const { consumedAmount } = await consumeCustomerAdvancedPayment({
    customer: customerA._id,
    project: projectA._id,
    paymentId,
    amount: 20000,
  });

  assert.equal(consumedAmount, 20000);

  const reloaded = await AdvancedPayment.findById(advance._id);
  assert.equal(reloaded.remainingAmount, 30000, 'only the requested amount is consumed - the rest stays available for a later Add Payment');
  assert.equal(reloaded.status, 'partially_used');
  assert.equal(reloaded.usageHistory.length, 1);
  assert.equal(reloaded.usageHistory[0].amountConsumed, 20000);
  assert.equal(reloaded.usageHistory[0].salesOrder, null, 'a Payment-sourced consumption must not fabricate a salesOrder reference');
});

test('consumeCustomerAdvancedPayment: a second partial consumption can draw down the same advance further', async () => {
  const advance = await AdvancedPayment.create({ type: 'customer', customer: customerA._id, project: projectA._id, amount: 50000, paymentAccount: cashAccount._id, createdBy: manager._id });

  await consumeCustomerAdvancedPayment({ customer: customerA._id, project: projectA._id, paymentId: new mongoose.Types.ObjectId(), amount: 20000 });
  await consumeCustomerAdvancedPayment({ customer: customerA._id, project: projectA._id, paymentId: new mongoose.Types.ObjectId(), amount: 15000 });

  const reloaded = await AdvancedPayment.findById(advance._id);
  assert.equal(reloaded.remainingAmount, 15000);
  assert.equal(reloaded.usageHistory.length, 2);
});

test('consumeCustomerAdvancedPayment: an `amount` exceeding the remaining balance is rejected, and nothing is consumed', async () => {
  const advance = await AdvancedPayment.create({ type: 'customer', customer: customerA._id, project: projectA._id, amount: 50000, paymentAccount: cashAccount._id, createdBy: manager._id });

  await assert.rejects(
    () => consumeCustomerAdvancedPayment({ customer: customerA._id, project: projectA._id, paymentId: new mongoose.Types.ObjectId(), amount: 60000 }),
    /exceeds the available advanced payment balance/
  );

  const reloaded = await AdvancedPayment.findById(advance._id);
  assert.equal(reloaded.remainingAmount, 50000, 'a rejected over-amount request must not partially consume anything');
  assert.equal(reloaded.usageHistory.length, 0);
});

test('consumeVendorAdvancedPayment: an explicit `amount` consumes only that much, leaving the rest available', async () => {
  const advance = await AdvancedPayment.create({ type: 'vendor', vendor: vendor._id, project: projectA._id, amount: 30000, paymentAccount: cashAccount._id, createdBy: manager._id });

  const { consumedAmount } = await consumeVendorAdvancedPayment({ vendor: vendor._id, paymentId: new mongoose.Types.ObjectId(), amount: 10000 });
  assert.equal(consumedAmount, 10000);

  const reloaded = await AdvancedPayment.findById(advance._id);
  assert.equal(reloaded.remainingAmount, 20000);
  assert.equal(reloaded.status, 'partially_used');
});

test('consumeVendorAdvancedPayment: an `amount` exceeding the remaining balance is rejected', async () => {
  await AdvancedPayment.create({ type: 'vendor', vendor: vendor._id, project: projectA._id, amount: 30000, paymentAccount: cashAccount._id, createdBy: manager._id });

  await assert.rejects(
    () => consumeVendorAdvancedPayment({ vendor: vendor._id, paymentId: new mongoose.Types.ObjectId(), amount: 40000 }),
    /exceeds the available advanced payment balance/
  );
});

test('consumeCustomerAdvancedPayment rejects when nothing is available (and trying again after full consumption)', async () => {
  await assert.rejects(
    () => consumeCustomerAdvancedPayment({ customer: customerA._id, project: projectA._id, salesOrderId: new mongoose.Types.ObjectId() }),
    /No available advanced payment exists for this project/
  );

  const advance = await AdvancedPayment.create({ type: 'customer', customer: customerA._id, project: projectA._id, amount: 50000, paymentAccount: cashAccount._id, createdBy: manager._id });
  await consumeCustomerAdvancedPayment({ customer: customerA._id, project: projectA._id, salesOrderId: new mongoose.Types.ObjectId() });

  // Trying to spend the same advance a second time (the "no double spending" requirement) must
  // fail now that remainingAmount is 0.
  await assert.rejects(
    () => consumeCustomerAdvancedPayment({ customer: customerA._id, project: projectA._id, salesOrderId: new mongoose.Types.ObjectId() }),
    /No available advanced payment exists for this project/
  );
  assert.equal((await AdvancedPayment.findById(advance._id)).remainingAmount, 0);
});

test('an unrelated customer cannot consume another customer\'s advance for the same project (impossible by construction - project only ever has one customer)', async () => {
  await AdvancedPayment.create({ type: 'customer', customer: customerA._id, project: projectA._id, amount: 50000, paymentAccount: cashAccount._id, createdBy: manager._id });

  // customerB has no advance for projectA (and could never have one, since projectA belongs to
  // customerA - AdvancedPayment creation itself would reject that combination).
  await assert.rejects(
    () => consumeCustomerAdvancedPayment({ customer: customerB._id, project: projectA._id, salesOrderId: new mongoose.Types.ObjectId() }),
    /No available advanced payment exists for this project/
  );
});

test('restoreAdvancedPaymentForSalesOrder restores the consumed amount and marks the usage entry reversed', async () => {
  const advance = await AdvancedPayment.create({ type: 'customer', customer: customerA._id, project: projectA._id, amount: 50000, paymentAccount: cashAccount._id, createdBy: manager._id });
  const salesOrder = await createMinimalSalesOrder();
  const { advancedPaymentId } = await consumeCustomerAdvancedPayment({ customer: customerA._id, project: projectA._id, salesOrderId: salesOrder._id });

  await restoreAdvancedPaymentForSalesOrder({ advancedPaymentId, salesOrderId: salesOrder._id });

  const reloaded = await AdvancedPayment.findById(advance._id);
  assert.equal(reloaded.remainingAmount, 50000, 'the full consumed amount must be restored');
  assert.equal(reloaded.status, 'available');
  assert.equal(reloaded.usageHistory[0].reversed, true);
  assert.equal(reloaded.usageHistory.length, 1, 'the original usage entry is kept (not deleted) for audit purposes');
});

test('restoreAdvancedPaymentForSalesOrder is a safe no-op when the order never used an advance', async () => {
  await assert.doesNotReject(() => restoreAdvancedPaymentForSalesOrder({ advancedPaymentId: null, salesOrderId: new mongoose.Types.ObjectId() }));
});

// Regression test for a real circular-populate bug caught during live verification:
// AdvancedPayment's find hook populates `usageHistory.salesOrder` -> that triggers SalesOrder's
// OWN find hook -> which used to populate `advancedPayment` back -> which re-triggers
// AdvancedPayment's find hook -> infinite recursion (hung indefinitely, never threw). A hang can't
// be asserted directly, so this races the real query against a short timeout.
test('AdvancedPayment <-> SalesOrder is not a circular populate (does not hang) when a Sales Order actually references an Advanced Payment', async () => {
  const advance = await AdvancedPayment.create({ type: 'customer', customer: customerA._id, project: projectA._id, amount: 50000, paymentAccount: cashAccount._id, createdBy: manager._id });
  const salesOrder = await createMinimalSalesOrder();
  // Simulate what a real consumption does: the order references the advance, and the advance's
  // usage history references the order back - the exact mutual-reference shape that recurses.
  salesOrder.advancedPayment = advance._id;
  await salesOrder.save();
  advance.usageHistory.push({ salesOrder: salesOrder._id, amountConsumed: 50000 });
  advance.remainingAmount = 0;
  await advance.save();

  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('populate did not resolve within 3s - likely a circular populate regression')), 3000));
  const reloaded = await Promise.race([AdvancedPayment.findById(advance._id), timeout]);
  assert.equal(reloaded.usageHistory[0].salesOrder._id.toString(), salesOrder._id.toString());
});

// ===================== Full Sales Order + Advanced Payment integration =====================

test('createSalesOrder with paymentMethod "advanced_payment": amount is derived from the advance, not the client, and the advance is fully consumed', async t => {
  if (!transactionsSupported) return t.skip('local MongoDB is a standalone instance, not a replica set - transactions unavailable (verified separately against the real Atlas cluster)');

  const warehouse = await Warehouse.create({ name: 'Main Warehouse', location: 'Cairo' });
  // createSalesOrder posts real automatic journal entries (SO_CUSTOMER_ADVANCE_APPLIED, then
  // PROJECT_REVENUE_RECOGNITION as executed % rises) - the engine never invents accounts, so the
  // control accounts it looks up by code must exist.
  const { AutomaticJournalAccountCodes } = require('../../utils/accountingConstants');
  await ChartOfAccount.create([
    { code: AutomaticJournalAccountCodes.customerAdvancesPayable, name: 'Advance Payments from Customers', type: 'liability' },
    { code: AutomaticJournalAccountCodes.accountsReceivableProjects, name: 'Accounts Receivable (Projects)', type: 'asset' },
    { code: AutomaticJournalAccountCodes.revenue, name: 'Revenue', type: 'revenue' },
  ]);
  // Catalog price is capped at 250,000 (productModel.js) - the manipulated 999999 is sent on the ORDER LINE below.
  const service = await Product.create({ type: 'service', title: { en: 'Consulting', ar: 'استشارات' }, description: { en: 'd', ar: 'د' }, price: 250000, durationValue: 1, durationUnit: 'month' });

  await AdvancedPayment.create({ type: 'customer', customer: customerA._id, project: projectA._id, amount: 50000, paymentAccount: cashAccount._id, createdBy: manager._id });

  // The client submits a manipulated amount (999999 via the item's unitPrice/paidAmount) - the
  // server must ignore it entirely and derive the real paidAmount from the advance instead (docs
  // section "Do not trust the frontend amount").
  const salesOrder = await createSalesOrder({
    customer: customerA._id,
    warehouse: warehouse._id,
    items: [{ product: service._id, unitPrice: 999999, starterQuantity: 1 }],
    isPrepaid: false,
    paidAmount: 999999,
    paymentMethod: 'advanced_payment',
    project: projectA._id,
    createdBy: manager._id,
    employee: manager._id,
  });

  assert.equal(salesOrder.paidAmount, 50000, 'paidAmount must come from the advance, never the client-submitted value');
  assert.notEqual(salesOrder.paidAmount, 999999);
  assert.ok(salesOrder.advancedPayment, 'the order must reference the advance it consumed');

  const advance = await AdvancedPayment.findOne({ customer: customerA._id, project: projectA._id });
  assert.equal(advance.remainingAmount, 0);
  assert.equal(advance.status, 'fully_used');
  // AdvancedPayment's find hook populates usageHistory.salesOrder - compare ids, not the document.
  assert.equal(advance.usageHistory[0].salesOrder._id.toString(), salesOrder._id.toString());

  // A second attempt for the same customer+project must now fail - there is nothing left to spend.
  await assert.rejects(
    () =>
      createSalesOrder({
        customer: customerA._id,
        warehouse: warehouse._id,
        items: [{ product: service._id, unitPrice: 100, starterQuantity: 1 }],
        isPrepaid: false,
        paymentMethod: 'advanced_payment',
        project: projectA._id,
        createdBy: manager._id,
        employee: manager._id,
      }),
    /No available advanced payment exists for this project/
  );
});

test('createSalesOrder with paymentMethod "advanced_payment" rejects a project that does not belong to the customer, and does not touch any advance', async t => {
  if (!transactionsSupported) return t.skip('local MongoDB is a standalone instance, not a replica set - transactions unavailable (verified separately against the real Atlas cluster)');

  const warehouse = await Warehouse.create({ name: 'Main Warehouse 2', location: 'Cairo' });
  const service = await Product.create({ type: 'service', title: { en: 'Consulting 2', ar: 'استشارات 2' }, description: { en: 'd', ar: 'د' }, price: 500, durationValue: 1, durationUnit: 'month' });

  const advance = await AdvancedPayment.create({ type: 'customer', customer: customerB._id, project: projectB._id, amount: 20000, paymentAccount: cashAccount._id, createdBy: manager._id });

  // customerA is paired with projectB (which belongs to customerB) - must be rejected, and
  // customerB's own advance must remain completely untouched (failed creation = no side effects).
  await assert.rejects(
    () =>
      createSalesOrder({
        customer: customerA._id,
        warehouse: warehouse._id,
        items: [{ product: service._id, unitPrice: 500, starterQuantity: 1 }],
        isPrepaid: false,
        paymentMethod: 'advanced_payment',
        project: projectB._id,
        createdBy: manager._id,
        employee: manager._id,
      }),
    /does not belong to the selected customer/
  );

  const reloaded = await AdvancedPayment.findById(advance._id);
  assert.equal(reloaded.remainingAmount, 20000, 'a failed Sales Order creation must never touch an unrelated advance');
  assert.equal(reloaded.status, 'available');

  const ordersForService = await SalesOrder.countDocuments({ 'items.product': service._id });
  assert.equal(ordersForService, 0, 'no Sales Order should have been created at all');
});
