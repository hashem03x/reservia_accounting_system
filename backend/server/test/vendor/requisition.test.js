const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// The new "Purchase Order" document (docs section "Implement Purchase Orders Before Purchase
// Invoices") - internally named Requisition (see requisitionModel.js's header comment for why).
// Purely operational: no journal entries, no accounting balances, ever. These tests never go
// through a Mongo transaction (the controller doesn't use one), so none are skipped locally.

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_requisition';

let Requisition, Vendor, Project, User, JournalEntry, Product, Category, Brand;
let requisitionController;

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
    Promise.resolve(handler({ headers: {}, query: {}, body: {}, params: {}, ...req }, res, err => (err ? reject(err) : resolve({ status: res.statusCode })))).catch(reject);
  });
}

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  Requisition = require('../../models/vendor/requisitionModel');
  Vendor = require('../../models/vendor/vendor');
  Project = require('../../models/project/projectModel');
  User = require('../../models/userModel');
  JournalEntry = require('../../models/accounting/journalEntryModel');
  // Requisition's own pre(/^find/) hook populates `items.product` (ref: 'Product') - must be
  // registered before any find/save triggers that populate, same convention as every other model
  // file in this codebase that populates a ref it doesn't otherwise require.
  Product = require('../../models/inventory/productModel');
  Category = require('../../models/categoryModel');
  Brand = require('../../models/brandModel');
  requisitionController = require('../../controller/vendor/requisitionController');
  await Promise.all([Requisition.init(), Vendor.init(), Project.init(), JournalEntry.init()]);
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

let seq = 0;
let vendor, project, manager;

beforeEach(async () => {
  await Promise.all(['requisitions', 'vendors', 'projects', 'users', 'journalentries', 'counters'].map(c => mongoose.connection.collection(c).deleteMany({})));
  seq += 1;
  manager = await User.create({ name: 'Req Manager', email: `req-manager-${seq}@example.com`, role: 'admin', type: 'online' });
  vendor = await Vendor.create({ name: 'Requisition Vendor', contact: { phone: `010${Date.now()}${seq}`.slice(0, 11) } });
  project = await Project.create({ projectNumber: `REQ-PRJ-${seq}`, projectManager: manager._id, startDate: new Date('2026-01-01'), deliveryDate: new Date('2026-12-31') });
});

function baseBody(overrides = {}) {
  return {
    vendorId: String(vendor._id),
    project: String(project._id),
    items: [{ description: 'Steel bars', quantity: 10, unitPrice: 100, unit: 'ton' }],
    ...overrides,
  };
}

// ===================== Creation, numbering, amount =====================

test('createRequisition: computes lineTotal/amount server-side, starts as draft, numbered sequentially', async () => {
  const first = await callHandler(requisitionController.createRequisition, { body: baseBody(), user: manager });
  assert.equal(first.status, 201);
  assert.equal(first.body.data.status, 'draft');
  assert.equal(first.body.data.items[0].lineTotal, 1000);
  assert.equal(first.body.data.amount, 1000);
  assert.match(first.body.data.code, /^\d{12}$/);

  const second = await callHandler(requisitionController.createRequisition, { body: baseBody(), user: manager });
  assert.notEqual(second.body.data.code, first.body.data.code, 'codes must be unique/sequential');
});

test('createRequisition: amount sums multiple line items correctly', async () => {
  const res = await callHandler(requisitionController.createRequisition, {
    body: baseBody({
      items: [
        { description: 'Line A', quantity: 2, unitPrice: 50 }, // 100
        { description: 'Line B', quantity: 3, unitPrice: 25 }, // 75
      ],
    }),
    user: manager,
  });
  assert.equal(res.body.data.amount, 175);
});

test('createRequisition: a zero-quantity or zero-price item is rejected (never a silently-zero line)', async () => {
  await assert.rejects(() =>
    callHandler(requisitionController.createRequisition, { body: baseBody({ items: [{ description: 'Bad', quantity: 0, unitPrice: 10 }] }), user: manager })
  );
});

test('createRequisition: creating one never produces a JournalEntry or touches the vendor balance (accounting isolation)', async () => {
  const startingBalance = vendor.balance;
  await callHandler(requisitionController.createRequisition, { body: baseBody(), user: manager });
  assert.equal(await JournalEntry.countDocuments({}), 0, 'a Purchase Order must never post any journal entry');
  const reloadedVendor = await Vendor.findById(vendor._id);
  assert.equal(reloadedVendor.balance, startingBalance, 'a Purchase Order must never change the vendor balance');
});

// ===================== Derived fields (remainingAmount / executedPercentage / effectiveStatus) =====================

test('a fresh Requisition (0 invoiced): remainingAmount = amount, executedPercentage = 0, effectiveStatus = draft', async () => {
  const res = await callHandler(requisitionController.createRequisition, { body: baseBody(), user: manager });
  const json = res.body.data.toJSON ? res.body.data.toJSON() : res.body.data;
  assert.equal(json.remainingAmount, 1000);
  assert.equal(json.executedPercentage, 0);
  assert.equal(json.effectiveStatus, 'draft');
});

test('a zero-amount Requisition never produces an invalid/NaN/Infinity percentage', async () => {
  // Not realistically createable (unitPrice/quantity must be positive), but guard the derived
  // formula itself directly against amount === 0.
  const req = new Requisition({ vendorId: vendor._id, project: project._id, items: [{ description: 'x', quantity: 1, unitPrice: 0.0001 }] });
  req.amount = 0; // force, bypassing the normal computed path, to test the derived-field guard itself
  const json = req.toJSON();
  assert.equal(json.executedPercentage, 0);
  assert.ok(Number.isFinite(json.executedPercentage));
});

// ===================== Status transitions =====================

test('openRequisition: draft -> open succeeds; opening twice is rejected', async () => {
  const created = await callHandler(requisitionController.createRequisition, { body: baseBody(), user: manager });
  const id = String(created.body.data._id);

  const opened = await callHandler(requisitionController.openRequisition, { params: { id } });
  assert.equal(opened.body.data.status, 'open');

  await assert.rejects(() => callHandler(requisitionController.openRequisition, { params: { id } }), /Only a draft/);
});

test('cancelRequisition: a never-invoiced draft or open Requisition can be cancelled', async () => {
  const created = await callHandler(requisitionController.createRequisition, { body: baseBody(), user: manager });
  const draftId = String(created.body.data._id);
  const cancelledDraft = await callHandler(requisitionController.cancelRequisition, { params: { id: draftId } });
  assert.equal(cancelledDraft.body.data.status, 'cancelled');

  const created2 = await callHandler(requisitionController.createRequisition, { body: baseBody(), user: manager });
  const id2 = String(created2.body.data._id);
  await callHandler(requisitionController.openRequisition, { params: { id: id2 } });
  const cancelledOpen = await callHandler(requisitionController.cancelRequisition, { params: { id: id2 } });
  assert.equal(cancelledOpen.body.data.status, 'cancelled');
});

test('cancelRequisition: rejects cancelling an already-cancelled Requisition', async () => {
  const created = await callHandler(requisitionController.createRequisition, { body: baseBody(), user: manager });
  const id = String(created.body.data._id);
  await callHandler(requisitionController.cancelRequisition, { params: { id } });
  await assert.rejects(() => callHandler(requisitionController.cancelRequisition, { params: { id } }), /already cancelled/);
});

test('cancelRequisition: rejects cancelling once ANY amount has been invoiced', async () => {
  const created = await callHandler(requisitionController.createRequisition, { body: baseBody(), user: manager });
  const id = String(created.body.data._id);
  await callHandler(requisitionController.openRequisition, { params: { id } });
  await Requisition.findByIdAndUpdate(id, { $inc: { invoicedAmount: 1 } }); // simulate a linked invoice
  await assert.rejects(() => callHandler(requisitionController.cancelRequisition, { params: { id } }), /already been partially or fully invoiced/);
});

// ===================== Catalog product selection (docs section "Purchase Orders - Select
// Products From the Catalog") =====================

test('createRequisition: a line item can reference a real catalog Product; it is stored and populated back', async () => {
  const category = await Category.create({ name: { en: 'Materials', ar: 'مواد' } });
  const brand = await Brand.create({ name: { en: 'ACME', ar: 'أكمي' } });
  const product = await Product.create({
    type: 'product',
    title: { en: 'Steel Bar', ar: 'قضيب حديد' },
    description: { en: 'd', ar: 'د' },
    price: 100,
    cost: 80,
    category: category._id,
    brand: brand._id,
  });

  const res = await callHandler(requisitionController.createRequisition, {
    body: baseBody({ items: [{ description: 'Steel bars', quantity: 10, unitPrice: 100, product: String(product._id) }] }),
    user: manager,
  });
  assert.equal(res.status, 201);
  const storedProduct = res.body.data.items[0].product;
  assert.equal(String(storedProduct?._id || storedProduct), String(product._id));

  const reloaded = await Requisition.findById(res.body.data._id);
  assert.equal(String(reloaded.items[0].product._id), String(product._id), 'the product reference must survive a reload (populated by the pre(/^find/) hook)');
});

test('createRequisition: items without a product reference still work - the description stays the canonical, required field', async () => {
  const res = await callHandler(requisitionController.createRequisition, { body: baseBody(), user: manager });
  assert.equal(res.status, 201);
  assert.equal(res.body.data.items[0].product, null);
});

test('updateRequisition: a draft can be edited (items recomputed); an open one cannot', async () => {
  const created = await callHandler(requisitionController.createRequisition, { body: baseBody(), user: manager });
  const id = String(created.body.data._id);

  const updated = await callHandler(requisitionController.updateRequisition, { params: { id }, body: { items: [{ description: 'New line', quantity: 1, unitPrice: 500 }] } });
  assert.equal(updated.body.data.amount, 500);

  await callHandler(requisitionController.openRequisition, { params: { id } });
  await assert.rejects(
    () => callHandler(requisitionController.updateRequisition, { params: { id }, body: { items: [{ description: 'x', quantity: 1, unitPrice: 1 }] } }),
    /Only a draft/
  );
});
