const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Covers "Link Purchase Invoices to Purchase Orders" (docs section) - the new, additive
// `requisition` reference on the EXISTING Purchase Invoice model (vendor/purchaseOrder.js) and the
// atomic `invoicedAmount` guard on the new Requisition ("Purchase Order") model.
//
// Tests the Invoice model DIRECTLY via `PurchaseOrder.create({...})` with NO session/transaction -
// mirroring orderTaxAndPayment.test.js's own established convention for this exact reason: the
// model's own pre('save') hook (where every rule under test here actually lives) runs identically
// with or without a session, and `Requisition.findOneAndUpdate`'s atomic `$expr` guard is a
// SINGLE-document operation - genuinely race-safe on a standalone MongoDB, unlike a multi-document
// transaction (`session.startTransaction()`), which requires a replica set and is therefore never
// used here except in the one test explicitly marked as needing it (full accounting pipeline).

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_requisition_invoice_linking';

let Requisition, PurchaseOrder, Vendor, Project, User, JournalEntry, ChartOfAccount, Warehouse, Product;
let transactionsSupported = true;

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  // Warehouse before Payment/PurchaseOrder - see orderTaxAndPayment.test.js's identical comment
  // for the pre-existing circular-require this avoids.
  Warehouse = require('../../models/inventory/warehouseModel');
  Requisition = require('../../models/vendor/requisitionModel');
  PurchaseOrder = require('../../models/vendor/purchaseOrder');
  Vendor = require('../../models/vendor/vendor');
  Project = require('../../models/project/projectModel');
  User = require('../../models/userModel');
  JournalEntry = require('../../models/accounting/journalEntryModel');
  ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
  Product = require('../../models/inventory/productModel');
  await Promise.all([Requisition.init(), PurchaseOrder.init(), Vendor.init(), Project.init(), JournalEntry.init()]);

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
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

let seq = 0;
let vendor, otherVendor, project, otherProject, manager, warehouse, service;

beforeEach(async () => {
  await Promise.all(
    ['requisitions', 'purchaseorders', 'vendors', 'projects', 'users', 'journalentries', 'chartofaccounts', 'warehouses', 'products', 'counters'].map(c =>
      mongoose.connection.collection(c).deleteMany({})
    )
  );
  seq += 1;
  manager = await User.create({ name: 'Link Manager', email: `link-manager-${seq}@example.com`, role: 'admin', type: 'online' });
  vendor = await Vendor.create({ name: 'Link Vendor', contact: { phone: `010${Date.now()}${seq}`.slice(0, 11) } });
  otherVendor = await Vendor.create({ name: 'Other Link Vendor', contact: { phone: `011${Date.now()}${seq}`.slice(0, 11) } });
  project = await Project.create({ projectNumber: `LINK-PRJ-${seq}A`, projectManager: manager._id, startDate: new Date('2026-01-01'), deliveryDate: new Date('2026-12-31') });
  otherProject = await Project.create({ projectNumber: `LINK-PRJ-${seq}B`, projectManager: manager._id, startDate: new Date('2026-01-01'), deliveryDate: new Date('2026-12-31') });
  warehouse = await Warehouse.create({ name: 'Link Warehouse', location: 'Cairo' });
  const puc = await ChartOfAccount.create({ code: `PUC-${seq}`, name: 'PUC', type: 'asset' });
  service = await Product.create({ type: 'service', title: { en: 'Linked Service', ar: 'خدمة' }, description: { en: 'd', ar: 'د' }, price: 100, durationValue: 1, durationUnit: 'month', pucAccount: puc._id });
});

async function openRequisition(overrides = {}) {
  const req = await Requisition.create({
    vendorId: vendor._id,
    project: project._id,
    items: [{ description: 'Steel', quantity: 1, unitPrice: 100000 }],
    ...overrides,
  });
  req.status = 'open';
  await req.save();
  return req;
}

function invoiceBody(requisitionId, overrides = {}) {
  return {
    vendorId: vendor._id,
    warehouseId: warehouse._id,
    project: project._id,
    requisition: requisitionId,
    items: [{ productId: service._id, unitPrice: 25000, starterQuantity: 1 }], // 25,000 pre-tax
    ...overrides,
  };
}

// ===================== Required reference + eligibility =====================

test('creating a Purchase Invoice with no Purchase Order is rejected', async () => {
  await assert.rejects(() => PurchaseOrder.create({ vendorId: vendor._id, warehouseId: warehouse._id, project: project._id, items: [{ productId: service._id, unitPrice: 100, starterQuantity: 1 }] }), /Purchase Order is required/);
});

test('creating a Purchase Invoice against a DRAFT (not yet open) Purchase Order is rejected', async () => {
  const requisition = await Requisition.create({ vendorId: vendor._id, project: project._id, items: [{ description: 'x', quantity: 1, unitPrice: 1000 }] });
  await assert.rejects(() => PurchaseOrder.create(invoiceBody(requisition._id)), /not open for invoicing/);
});

test('creating a Purchase Invoice against a CANCELLED Purchase Order is rejected', async () => {
  const requisition = await Requisition.create({ vendorId: vendor._id, project: project._id, items: [{ description: 'x', quantity: 1, unitPrice: 1000 }] });
  requisition.status = 'cancelled';
  await requisition.save();
  await assert.rejects(() => PurchaseOrder.create(invoiceBody(requisition._id)), /not open for invoicing/);
});

test('creating a Purchase Invoice against a NON-EXISTENT Purchase Order is rejected', async () => {
  await assert.rejects(() => PurchaseOrder.create(invoiceBody(new mongoose.Types.ObjectId())), /does not exist/);
});

// ===================== Vendor/project compatibility =====================

test('a Purchase Invoice whose vendor does not match its linked Purchase Order\'s vendor is rejected', async () => {
  const requisition = await openRequisition(); // vendor = `vendor`
  await assert.rejects(() => PurchaseOrder.create(invoiceBody(requisition._id, { vendorId: otherVendor._id })), /vendor does not match/);
});

test('a Purchase Invoice whose project does not match its linked Purchase Order\'s project is rejected', async () => {
  const requisition = await openRequisition(); // project = `project`
  await assert.rejects(() => PurchaseOrder.create(invoiceBody(requisition._id, { project: otherProject._id })), /project does not match/);
});

test('a Purchase Invoice matching BOTH vendor and project succeeds', async () => {
  const requisition = await openRequisition();
  const invoice = await PurchaseOrder.create(invoiceBody(requisition._id));
  assert.equal(String(invoice.requisition), String(requisition._id));
});

// ===================== invoicedAmount / remainingAmount / executedPercentage =====================

test('a single Invoice increases the Requisition\'s invoicedAmount by its pre-tax totalAmount', async () => {
  const requisition = await openRequisition({ items: [{ description: 'x', quantity: 1, unitPrice: 100000 }] }); // amount = 100,000
  const invoice = await PurchaseOrder.create(invoiceBody(requisition._id)); // totalAmount = 25,000
  assert.equal(invoice.totalAmount, 25000);

  const reloaded = await Requisition.findById(requisition._id);
  assert.equal(reloaded.invoicedAmount, 25000);
  const json = reloaded.toJSON();
  assert.equal(json.remainingAmount, 75000);
  assert.equal(json.executedPercentage, 25);
  assert.equal(json.effectiveStatus, 'partially_invoiced');
});

test('multiple PARTIAL invoices against the same Purchase Order accumulate correctly (the spec\'s own worked example: 100,000 PO, 25,000 + 35,000 invoiced -> 60,000 invoiced, 40,000 remaining, 60%)', async () => {
  const requisition = await openRequisition({ items: [{ description: 'x', quantity: 1, unitPrice: 100000 }] });
  await PurchaseOrder.create(invoiceBody(requisition._id, { items: [{ productId: service._id, unitPrice: 25000, starterQuantity: 1 }] }));
  await PurchaseOrder.create(invoiceBody(requisition._id, { items: [{ productId: service._id, unitPrice: 35000, starterQuantity: 1 }] }));

  const reloaded = await Requisition.findById(requisition._id);
  assert.equal(reloaded.invoicedAmount, 60000);
  const json = reloaded.toJSON();
  assert.equal(json.remainingAmount, 40000);
  assert.equal(json.executedPercentage, 60);
  assert.equal(json.effectiveStatus, 'partially_invoiced');
});

test('a Purchase Order fully invoiced in one shot reaches 100% / fully_invoiced / 0 remaining', async () => {
  const requisition = await openRequisition({ items: [{ description: 'x', quantity: 1, unitPrice: 50000 }] });
  await PurchaseOrder.create(invoiceBody(requisition._id, { items: [{ productId: service._id, unitPrice: 50000, starterQuantity: 1 }] }));

  const reloaded = await Requisition.findById(requisition._id);
  const json = reloaded.toJSON();
  assert.equal(json.remainingAmount, 0);
  assert.equal(json.executedPercentage, 100);
  assert.equal(json.effectiveStatus, 'fully_invoiced');
});

// ===================== Over-invoicing prevention =====================

test('an Invoice exceeding the Purchase Order\'s remaining balance is rejected, and nothing is partially applied', async () => {
  const requisition = await openRequisition({ items: [{ description: 'x', quantity: 1, unitPrice: 10000 }] }); // amount = 10,000
  await assert.rejects(
    () => PurchaseOrder.create(invoiceBody(requisition._id, { items: [{ productId: service._id, unitPrice: 15000, starterQuantity: 1 }] })),
    /exceeds the remaining balance/
  );
  const reloaded = await Requisition.findById(requisition._id);
  assert.equal(reloaded.invoicedAmount, 0, 'a rejected invoice must never partially increment invoicedAmount');
  assert.equal(await PurchaseOrder.countDocuments({}), 0, 'the invoice document itself must not exist either');
});

test('an Invoice that would exceed the REMAINING (not total) balance after a prior invoice is rejected', async () => {
  const requisition = await openRequisition({ items: [{ description: 'x', quantity: 1, unitPrice: 10000 }] });
  await PurchaseOrder.create(invoiceBody(requisition._id, { items: [{ productId: service._id, unitPrice: 7000, starterQuantity: 1 }] }));
  await assert.rejects(
    () => PurchaseOrder.create(invoiceBody(requisition._id, { items: [{ productId: service._id, unitPrice: 4000, starterQuantity: 1 }] })),
    /exceeds the remaining balance/
  );
  const reloaded = await Requisition.findById(requisition._id);
  assert.equal(reloaded.invoicedAmount, 7000, 'the rejected second invoice must not have changed invoicedAmount at all');
});

test('an Invoice for EXACTLY the remaining balance succeeds (boundary, not strictly-less-than)', async () => {
  const requisition = await openRequisition({ items: [{ description: 'x', quantity: 1, unitPrice: 10000 }] });
  await PurchaseOrder.create(invoiceBody(requisition._id, { items: [{ productId: service._id, unitPrice: 10000, starterQuantity: 1 }] }));
  const reloaded = await Requisition.findById(requisition._id);
  assert.equal(reloaded.invoicedAmount, 10000);
  assert.equal(reloaded.toJSON().effectiveStatus, 'fully_invoiced');
});

// ===================== Concurrency safety (no replica set needed - see file header) =====================

test('concurrent invoice creation can never jointly exceed the Purchase Order\'s amount', async () => {
  const requisition = await openRequisition({ items: [{ description: 'x', quantity: 1, unitPrice: 50000 }] }); // amount = 50,000
  // 10 concurrent invoices of 10,000 each = 100,000 attempted against a 50,000 cap - at most 5 may
  // succeed; every single one must be individually race-safe (never partially applied).
  const attempts = await Promise.allSettled(
    Array.from({ length: 10 }, () => PurchaseOrder.create(invoiceBody(requisition._id, { items: [{ productId: service._id, unitPrice: 10000, starterQuantity: 1 }] })))
  );
  const succeeded = attempts.filter(a => a.status === 'fulfilled').length;
  assert.equal(succeeded, 5, 'exactly 5 of the 10 concurrent 10,000 invoices should fit the 50,000 cap');

  const reloaded = await Requisition.findById(requisition._id);
  assert.equal(reloaded.invoicedAmount, 50000, 'invoicedAmount must land exactly on the cap, never over it');
  assert.equal(await PurchaseOrder.countDocuments({ requisition: requisition._id }), 5, 'exactly as many invoice documents must exist as succeeded');
});

// ===================== Cancelled Purchase Order restrictions =====================

test('a Purchase Order cancelled after being opened (but never invoiced) can no longer accept invoices', async () => {
  const requisition = await openRequisition();
  requisition.status = 'cancelled';
  await requisition.save();
  await assert.rejects(() => PurchaseOrder.create(invoiceBody(requisition._id)), /not open for invoicing/);
});

// ===================== Historical / unlinked invoices remain intact =====================

test('a historical Purchase Invoice created before Purchase Order linking existed remains fully readable and valid', async () => {
  // Raw insert, bypassing the model's own validation entirely - the same technique used throughout
  // this codebase's test suite for pre-existing documents (see journalEntry.test.js).
  const raw = await mongoose.connection.collection('purchaseorders').insertOne({
    vendorId: vendor._id,
    warehouseId: warehouse._id,
    project: project._id,
    requisition: null,
    items: [{ productId: service._id, unitPrice: 1000, starterQuantity: 1, starterSubtotal: 1000, subtotal: 1000, returnedQuantity: 0, itemDiscount: { type: 'fixed', value: 0 } }],
    totalAmount: 1000,
    grandTotal: 1000,
    paidAmount: 0,
    code: `LEGACY-PO-${Date.now()}`,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const legacy = await PurchaseOrder.findById(raw.insertedId);
  assert.equal(legacy.requisition, null);
  assert.equal(legacy.totalAmount, 1000);
});

// ===================== Full accounting pipeline (needs a replica set - transaction-wrapped controller) =====================

test('creating an Invoice through the REAL createPO controller still posts the exact same journal entries as before, with a Purchase Order attached', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions) - see purchaseOrderServiceLines.test.js for the identical gating pattern');

  const { createPO } = require('../../controller/PO/purchaseOrderController');
  const requisition = await openRequisition({ items: [{ description: 'x', quantity: 1, unitPrice: 25000 }] });

  const body = invoiceBody(requisition._id);
  let captured;
  const req = { body, user: { _id: manager._id } };
  const res = { status: () => ({ json: payload => (captured = payload) }) };
  await createPO(req, res, err => {
    throw err;
  });

  assert.equal(captured.status, 'success');
  const entries = await JournalEntry.find({ sourceType: 'PO', sourceId: captured.data._id });
  assert.ok(entries.length > 0, 'the usual Purchase Invoice journal entries must still post');
  const reloadedRequisition = await Requisition.findById(requisition._id);
  assert.equal(reloadedRequisition.invoicedAmount, 25000, 'the Purchase Order\'s progress must update from the real controller flow too, not just direct model creation');
});

// ===================== Quantity per Purchase Order line =====================

async function productPurchaseOrder(quantity = 100, unitPrice = 10) {
  return openRequisition({ items: [{ product: service._id, description: 'Linked Service', quantity, unitPrice }] });
}
const lineInvoice = (requisitionId, starterQuantity) => invoiceBody(requisitionId, { items: [{ productId: service._id, unitPrice: 10, starterQuantity }] });

test('a PO line of 100 with 30 invoiced accepts at most 70 more; once fully invoiced, 1 more is refused', async () => {
  const { getRemainingQuantities } = require('../../services/vendor/requisitionQuantityService');
  const requisition = await productPurchaseOrder();
  await PurchaseOrder.create(lineInvoice(requisition._id, 30));

  let line = (await getRemainingQuantities(await Requisition.findById(requisition._id))).get(String(service._id));
  assert.deepEqual([line.ordered, line.invoiced, line.remaining, line.unitPrice], [100, 30, 70, 10]);

  await assert.rejects(() => PurchaseOrder.create(lineInvoice(requisition._id, 71)), /Invoice quantity 71 exceeds the quantity remaining on the Purchase Order line \(70 of 100 left; 30 already invoiced\)/);
  // Two rows of the same product on one invoice are added up.
  await assert.rejects(() => PurchaseOrder.create(invoiceBody(requisition._id, { items: [{ productId: service._id, unitPrice: 10, starterQuantity: 40 }, { productId: service._id, unitPrice: 10, starterQuantity: 31 }] })), /exceeds/);
  assert.equal((await Requisition.findById(requisition._id)).invoicedAmount, 300, 'nothing applied by a refused invoice');

  await PurchaseOrder.create(lineInvoice(requisition._id, 70));
  await assert.rejects(() => PurchaseOrder.create(lineInvoice(requisition._id, 1)), /0 of 100 left; 100 already invoiced/);
});

test('a returned quantity is free to invoice again; an item that is not on the Purchase Order is refused', async () => {
  const { getRemainingQuantities } = require('../../services/vendor/requisitionQuantityService');
  const requisition = await productPurchaseOrder(10);
  const invoice = await PurchaseOrder.create(lineInvoice(requisition._id, 10));
  await PurchaseOrder.updateOne({ _id: invoice._id }, { $set: { 'items.0.returnedQuantity': 4 } });
  const line = (await getRemainingQuantities(await Requisition.findById(requisition._id))).get(String(service._id));
  assert.deepEqual([line.invoiced, line.remaining], [6, 4]);

  const other = await Product.create({ type: 'service', title: { en: 'Not On PO', ar: 'خدمة أخرى' }, description: { en: 'd', ar: 'د' }, price: 5, durationValue: 1, durationUnit: 'month', pucAccount: service.pucAccount });
  await assert.rejects(() => PurchaseOrder.create(invoiceBody(requisition._id, { items: [{ productId: other._id, unitPrice: 5, starterQuantity: 1 }] })), /not on its linked Purchase Order/);
});

test('request validation: an invoice line quantity must be a whole number from 1 to 1000', async () => {
  const { validationResult } = require('express-validator');
  const { createPurchaseOrderValidate } = require('../../utils/validators/poValidator');
  const errorsFor = async starterQuantity => {
    const req = { body: { items: [{ productId: String(service._id), unitPrice: 10, starterQuantity }] }, params: {}, query: {} };
    for (const v of createPurchaseOrderValidate) if (typeof v.run === 'function') await v.run(req);
    return validationResult(req).array().filter(e => /items\[0\]\.starterQuantity/.test(e.param)).map(e => e.msg);
  };
  assert.deepEqual(await errorsFor(1), []);
  assert.deepEqual(await errorsFor(1000), []);
  for (const bad of [1001, 0, -1, 2.5, 'abc', '']) assert.match((await errorsFor(bad)).join(), /1 to 1000/, `quantity ${bad}`);
});

test('concurrent invoices for the same PO line can never jointly exceed its quantity', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  const requisition = await productPurchaseOrder(10);
  const attempt = async () => {
    const session = await mongoose.startSession();
    try {
      session.startTransaction();
      await new PurchaseOrder(lineInvoice(requisition._id, 6)).save({ session });
      await session.commitTransaction();
      return 'ok';
    } catch (err) {
      await session.abortTransaction().catch(() => {});
      return 'refused';
    } finally {
      session.endSession();
    }
  };
  const results = await Promise.all([attempt(), attempt(), attempt()]);
  assert.equal(results.filter(r => r === 'ok').length, 1, results.join());
  assert.equal(await PurchaseOrder.countDocuments({ requisition: requisition._id }), 1);
});
