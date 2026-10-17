const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { validationResult } = require('express-validator');

// Covers Phase 2's "Payment Terms for Customers and Vendors" (docs section): the pure
// calculateDueDate helper, the widened Vendor.paymentTerms enum (additive - the original four
// 'Net X' values are preserved exactly), the new identical Customer.paymentTerms field, and the
// SalesOrder/PurchaseOrder `dueDate` snapshot behavior (computed once at creation from the
// customer's/vendor's CURRENT terms, never recomputed on a later re-save or when their default
// terms change afterward).

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_payment_terms_due_date';

let User, Vendor, SalesOrder, PurchaseOrder, Warehouse, Product, Project;
let calculateDueDate;
let customer, vendor, warehouse, product, manager, project;

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();

  ({ calculateDueDate } = require('../../utils/helpers/dueDate'));
  // Warehouse must be required before Payment/PurchaseOrder - see orderTaxAndPayment.test.js's
  // identical comment for why (pre-existing circular require, unrelated to this phase).
  Warehouse = require('../../models/inventory/warehouseModel');
  User = require('../../models/userModel');
  Vendor = require('../../models/vendor/vendor');
  SalesOrder = require('../../models/sales/salesOrderModel');
  PurchaseOrder = require('../../models/vendor/purchaseOrder');
  Product = require('../../models/inventory/productModel');
  Project = require('../../models/project/projectModel');

  await Promise.all([User.init(), Vendor.init(), SalesOrder.init(), PurchaseOrder.init(), Project.init()]);
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Vendor.deleteMany({}),
    SalesOrder.deleteMany({}),
    PurchaseOrder.deleteMany({}),
    Warehouse.deleteMany({}),
    Product.deleteMany({}),
    Project.deleteMany({}),
  ]);

  customer = await User.create({ name: 'Due Date Customer', email: `duedate-customer-${Date.now()}@example.com`, role: 'user', type: 'online', paymentTerms: 'Net 30' });
  vendor = await Vendor.create({ name: 'Due Date Vendor', contact: { phone: `010${Date.now()}`.slice(0, 11) }, paymentTerms: 'Net 15' });
  manager = await User.create({ name: 'Due Date Manager', email: `duedate-manager-${Date.now()}@example.com`, role: 'admin', type: 'online' });
  warehouse = await Warehouse.create({ name: 'Due Date Warehouse', location: 'Cairo' });
  product = await Product.create({ type: 'service', title: { en: 'Due Date Service', ar: 'خدمة' }, description: { en: 'd', ar: 'د' }, price: 100, durationValue: 1, durationUnit: 'month' });
  project = await Project.create({
    projectNumber: `DUE-PRJ-${Date.now()}`,
    projectManager: manager._id,
    startDate: new Date(),
    deliveryDate: new Date(Date.now() + 86400000),
  });
});

// ===================== calculateDueDate (pure function) =====================

test('calculateDueDate: "Immediate" returns the same date as the invoice', () => {
  const invoiceDate = new Date('2026-03-15T00:00:00.000Z');
  const due = calculateDueDate(invoiceDate, 'Immediate', null);
  assert.equal(due.toISOString().slice(0, 10), '2026-03-15');
});

test('calculateDueDate: "Net X" adds X days', () => {
  const invoiceDate = new Date('2026-03-01T00:00:00.000Z');
  assert.equal(calculateDueDate(invoiceDate, 'Net 15', null).toISOString().slice(0, 10), '2026-03-16');
  assert.equal(calculateDueDate(invoiceDate, 'Net 30', null).toISOString().slice(0, 10), '2026-03-31');
  assert.equal(calculateDueDate(invoiceDate, 'Net 45', null).toISOString().slice(0, 10), '2026-04-15');
  assert.equal(calculateDueDate(invoiceDate, 'Net 60', null).toISOString().slice(0, 10), '2026-04-30');
});

test('calculateDueDate: "Custom" adds the given number of days', () => {
  const invoiceDate = new Date('2026-03-01T00:00:00.000Z');
  assert.equal(calculateDueDate(invoiceDate, 'Custom', 10).toISOString().slice(0, 10), '2026-03-11');
  assert.equal(calculateDueDate(invoiceDate, 'Custom', 0).toISOString().slice(0, 10), '2026-03-01');
});

test('calculateDueDate: correctly rolls over a month boundary (Jan 31 + Net 30)', () => {
  const invoiceDate = new Date('2026-01-31T00:00:00.000Z');
  assert.equal(calculateDueDate(invoiceDate, 'Net 30', null).toISOString().slice(0, 10), '2026-03-02');
});

test('calculateDueDate: correctly rolls over a year boundary (Dec 15 + Net 30)', () => {
  const invoiceDate = new Date('2026-12-15T00:00:00.000Z');
  const due = calculateDueDate(invoiceDate, 'Net 30', null);
  assert.equal(due.toISOString().slice(0, 10), '2027-01-14');
});

test('calculateDueDate: unknown/missing terms never invents a date - returns the invoice date unchanged', () => {
  const invoiceDate = new Date('2026-03-01T00:00:00.000Z');
  assert.equal(calculateDueDate(invoiceDate, undefined, null).toISOString().slice(0, 10), '2026-03-01');
  assert.equal(calculateDueDate(invoiceDate, 'Not A Real Term', null).toISOString().slice(0, 10), '2026-03-01');
});

// ===================== Vendor/Customer paymentTerms enum (additive widening) =====================

test('Vendor.paymentTerms: the original four Net values still validate (additive widening never breaks historical data)', async () => {
  const names = { 'Net 15': 'Vendor Fifteen', 'Net 30': 'Vendor Thirty', 'Net 45': 'Vendor FortyFive', 'Net 60': 'Vendor Sixty' };
  let i = 0;
  for (const term of ['Net 15', 'Net 30', 'Net 45', 'Net 60']) {
    i += 1;
    const v = await Vendor.create({ name: names[term], contact: { phone: `0111000${String(i).padStart(4, '0')}` }, paymentTerms: term });
    assert.equal(v.paymentTerms, term);
  }
});

test('Vendor.paymentTerms: the new "Immediate" and "Custom" values are also accepted', async () => {
  const immediate = await Vendor.create({ name: 'Immediate Vendor', contact: { phone: `012${Date.now()}`.slice(0, 11) }, paymentTerms: 'Immediate' });
  assert.equal(immediate.paymentTerms, 'Immediate');
  const custom = await Vendor.create({ name: 'Custom Vendor', contact: { phone: `015${Date.now()}`.slice(0, 11) }, paymentTerms: 'Custom', customPaymentDays: 90 });
  assert.equal(custom.paymentTerms, 'Custom');
  assert.equal(custom.customPaymentDays, 90);
});

test('Vendor.paymentTerms: rejects an invalid value', async () => {
  await assert.rejects(() => Vendor.create({ name: 'Bad Terms Vendor', contact: { phone: `010${Date.now()}`.slice(0, 11) }, paymentTerms: 'Net 90' }));
});

test('createVendorValidators: Custom payment terms requires customPaymentDays', async () => {
  const { createVendorValidators } = require('../../utils/validators/vendorValidators');
  const req = { body: { name: 'X', contact: { phone: '01012345678', email: 'x@example.com' }, paymentTerms: 'Custom' }, params: {}, query: {} };
  for (const m of createVendorValidators) {
    if (typeof m.run === 'function') await m.run(req);
  }
  const result = validationResult(req);
  assert.equal(result.isEmpty(), false);
  assert.ok(result.array().some(e => /customPaymentDays is required/.test(e.msg)));
});

test('createCustomerValidate: Custom payment terms requires customPaymentDays', async () => {
  const { createCustomerValidate } = require('../../utils/validators/customerValidator');
  const req = { body: { name: 'X', contact: { phone: '01012345678', email: 'x@example.com' }, paymentTerms: 'Custom' }, params: {}, query: {} };
  for (const m of createCustomerValidate) {
    if (typeof m.run === 'function') await m.run(req);
  }
  const result = validationResult(req);
  assert.equal(result.isEmpty(), false);
  assert.ok(result.array().some(e => /customPaymentDays is required/.test(e.msg)));
});

// ===================== SalesOrder/PurchaseOrder dueDate snapshot =====================

test('SalesOrder: dueDate is computed at creation from the customer\'s CURRENT payment terms', async () => {
  const order = await SalesOrder.create({
    customer: customer._id,
    warehouse: warehouse._id,
    project: project._id,
    orderSource: 'cashier',
    employee: manager._id,
    items: [{ product: product._id, unitPrice: 1000, starterQuantity: 1 }],
  });
  assert.ok(order.dueDate, 'dueDate must be set for a new order');
  const expected = calculateDueDate(order.createdAt, 'Net 30', null);
  assert.equal(order.dueDate.toISOString().slice(0, 10), expected.toISOString().slice(0, 10));
});

test('PurchaseOrder: dueDate is computed at creation from the vendor\'s CURRENT payment terms', async () => {
  const Requisition = require('../../models/vendor/requisitionModel');
  const requisition = await Requisition.create({ vendorId: vendor._id, project: project._id, items: [{ description: 'x', quantity: 1, unitPrice: 1000 }] });
  requisition.status = 'open';
  await requisition.save();
  const order = await PurchaseOrder.create({
    vendorId: vendor._id,
    warehouseId: warehouse._id,
    project: project._id,
    requisition: requisition._id,
    items: [{ productId: product._id, unitPrice: 1000, starterQuantity: 1 }],
  });
  assert.ok(order.dueDate, 'dueDate must be set for a new order');
  const expected = calculateDueDate(order.createdAt, 'Net 15', null);
  assert.equal(order.dueDate.toISOString().slice(0, 10), expected.toISOString().slice(0, 10));
});

test('SalesOrder: changing the customer\'s default payment terms AFTER an order was created never retroactively changes that order\'s dueDate', async () => {
  const order = await SalesOrder.create({
    customer: customer._id,
    warehouse: warehouse._id,
    project: project._id,
    orderSource: 'cashier',
    employee: manager._id,
    items: [{ product: product._id, unitPrice: 1000, starterQuantity: 1 }],
  });
  const originalDueDate = order.dueDate.toISOString();

  customer.paymentTerms = 'Net 60';
  await customer.save();

  // Re-saving the existing order (e.g. a cancel/deliver path) must not recompute dueDate - it's
  // only ever set once, at creation (`this.isNew && !this.dueDate`).
  const reloaded = await SalesOrder.findById(order._id);
  reloaded.orderStatus = 'delivered';
  await reloaded.save();

  const final = await SalesOrder.findById(order._id);
  assert.equal(final.dueDate.toISOString(), originalDueDate, 'an already-set dueDate must never be recomputed on a later save');

  // A brand NEW order for the same customer DOES use the now-current terms.
  const newOrder = await SalesOrder.create({
    customer: customer._id,
    warehouse: warehouse._id,
    project: project._id,
    orderSource: 'cashier',
    employee: manager._id,
    items: [{ product: product._id, unitPrice: 1000, starterQuantity: 1 }],
  });
  const expectedNew = calculateDueDate(newOrder.createdAt, 'Net 60', null);
  assert.equal(newOrder.dueDate.toISOString().slice(0, 10), expectedNew.toISOString().slice(0, 10));
});

test('SalesOrder/PurchaseOrder: a historical order (raw-inserted, no dueDate) stays null - never backfilled on read', async () => {
  const entryNumber = Date.now();
  await mongoose.connection.collection('salesorders').insertOne({
    customer: customer._id,
    warehouse: warehouse._id,
    project: project._id,
    orderSource: 'cashier',
    employee: manager._id,
    items: [{ product: product._id, unitPrice: 1000, starterQuantity: 1, starterSubtotal: 1000, subtotal: 1000, returnedQuantity: 0, itemDiscount: { type: 'fixed', value: 0 } }],
    totalAmount: 1000,
    paidAmount: 0,
    code: `LEGACY-SO-${entryNumber}`,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const legacy = await SalesOrder.findOne({ code: `LEGACY-SO-${entryNumber}` });
  assert.equal(legacy.dueDate, null, 'a historical order must never have a dueDate fabricated for it');
});
