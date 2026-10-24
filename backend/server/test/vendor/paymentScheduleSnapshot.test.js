const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Vendor Payment Terms - Lump Sum and Installments: covers the Purchase Invoice
// (vendor/purchaseOrder.js) side of the feature - the `paymentSchedule` snapshot taken at
// creation time from the vendor's CURRENT `paymentTermsConfig`, against the invoice's own
// grandTotal (after VAT/withholding). Mirrors requisitionInvoiceLinking.test.js's established
// convention: create an open Requisition, then `PurchaseOrder.create(...)` directly (no
// session/transaction needed - the pre('save') hook under test runs identically either way).

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_payment_schedule_snapshot';

let Requisition, PurchaseOrder, Vendor, Project, User, Warehouse, Product;

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  Warehouse = require('../../models/inventory/warehouseModel');
  Requisition = require('../../models/vendor/requisitionModel');
  PurchaseOrder = require('../../models/vendor/purchaseOrder');
  Vendor = require('../../models/vendor/vendor');
  Project = require('../../models/project/projectModel');
  User = require('../../models/userModel');
  Product = require('../../models/inventory/productModel');
  await Promise.all([Requisition.init(), PurchaseOrder.init(), Vendor.init(), Project.init()]);
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

let seq = 0;
let vendor, project, manager, warehouse, service;

beforeEach(async () => {
  await Promise.all(
    ['requisitions', 'purchaseorders', 'vendors', 'projects', 'users', 'warehouses', 'products', 'counters'].map(c => mongoose.connection.collection(c).deleteMany({})),
  );
  seq += 1;
  manager = await User.create({ name: 'Schedule Manager', email: `schedule-manager-${seq}@example.com`, role: 'admin', type: 'online' });
  project = await Project.create({ projectNumber: `SCH-PRJ-${seq}`, projectManager: manager._id, startDate: new Date('2026-01-01'), deliveryDate: new Date('2026-12-31') });
  warehouse = await Warehouse.create({ name: 'Schedule Warehouse', location: 'Cairo' });
  service = await Product.create({ type: 'service', title: { en: 'Scheduled Service', ar: 'خدمة' }, description: { en: 'd', ar: 'د' }, price: 100, durationValue: 1, durationUnit: 'month' });

  vendor = await Vendor.create({
    name: 'Schedule Vendor',
    contact: { phone: `010${Date.now()}${seq}`.slice(0, 11) },
    paymentTermsConfig: {
      kind: 'installments',
      installments: [{ durationDays: 30, percentage: 40 }, { durationDays: 30, percentage: 35 }, { durationDays: 30, percentage: 25 }],
    },
  });
});

async function openRequisition() {
  const req = await Requisition.create({ vendorId: vendor._id, project: project._id, items: [{ description: 'x', quantity: 1, unitPrice: 1000000 }] });
  req.status = 'open';
  await req.save();
  return req;
}

test('a new Purchase Invoice snapshots the vendor\'s installment schedule, exactly reconciling to grandTotal', async () => {
  const requisition = await openRequisition();
  const invoice = await PurchaseOrder.create({
    vendorId: vendor._id,
    warehouseId: warehouse._id,
    project: project._id,
    requisition: requisition._id,
    items: [{ productId: service._id, unitPrice: 1000, starterQuantity: 1 }],
  });

  assert.equal(invoice.paymentSchedule.length, 3);
  const sum = invoice.paymentSchedule.reduce((s, row) => s + row.amount, 0);
  assert.ok(Math.abs(sum - invoice.grandTotal) < 0.01, `schedule (${sum}) must reconcile exactly to grandTotal (${invoice.grandTotal})`);
  assert.deepEqual(invoice.paymentSchedule.map(r => r.percentage), [40, 35, 25]);
});

test('later changes to the vendor\'s payment terms never retroactively rewrite an existing invoice\'s schedule', async () => {
  const requisition = await openRequisition();
  const invoice = await PurchaseOrder.create({
    vendorId: vendor._id,
    warehouseId: warehouse._id,
    project: project._id,
    requisition: requisition._id,
    items: [{ productId: service._id, unitPrice: 1000, starterQuantity: 1 }],
  });
  const originalSchedule = JSON.parse(JSON.stringify(invoice.paymentSchedule));

  vendor.paymentTermsConfig = { kind: 'lump_sum', lumpSum: { timing: 'deferred', durationDays: 15 } };
  await vendor.save();

  const reloadedInvoice = await PurchaseOrder.findById(invoice._id);
  assert.deepEqual(JSON.parse(JSON.stringify(reloadedInvoice.paymentSchedule)), originalSchedule, 'the invoice must keep the schedule it was created with');
});

test('a vendor with the default immediate lump sum produces a single, full-amount, zero-duration row', async () => {
  const immediateVendor = await Vendor.create({ name: 'Immediate Vendor', contact: { phone: `012${Date.now()}${seq}`.slice(0, 11) } });
  const req = await Requisition.create({ vendorId: immediateVendor._id, project: project._id, items: [{ description: 'x', quantity: 1, unitPrice: 1000000 }] });
  req.status = 'open';
  await req.save();

  const invoice = await PurchaseOrder.create({
    vendorId: immediateVendor._id,
    warehouseId: warehouse._id,
    project: project._id,
    requisition: req._id,
    items: [{ productId: service._id, unitPrice: 1000, starterQuantity: 1 }],
  });

  assert.equal(invoice.paymentSchedule.length, 1);
  assert.equal(invoice.paymentSchedule[0].durationDays, 0);
  assert.ok(Math.abs(invoice.paymentSchedule[0].amount - invoice.grandTotal) < 0.01);
});
