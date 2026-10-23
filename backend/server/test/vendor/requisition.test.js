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
let vendor, project, manager, catalogProduct;

beforeEach(async () => {
  await Promise.all(['requisitions', 'vendors', 'projects', 'users', 'journalentries', 'counters'].map(c => mongoose.connection.collection(c).deleteMany({})));
  seq += 1;
  manager = await User.create({ name: 'Req Manager', email: `req-manager-${seq}@example.com`, role: 'admin', type: 'online' });
  vendor = await Vendor.create({ name: 'Requisition Vendor', contact: { phone: `010${Date.now()}${seq}`.slice(0, 11) } });
  project = await Project.create({ projectNumber: `REQ-PRJ-${seq}`, projectManager: manager._id, startDate: new Date('2026-01-01'), deliveryDate: new Date('2026-12-31') });
  catalogProduct = await Product.create({
    type: 'product',
    title: { en: `Steel Bars ${seq}`, ar: `حديد ${seq}` },
    description: { en: 'd', ar: 'د' },
    category: new mongoose.Types.ObjectId(),
    brand: new mongoose.Types.ObjectId(),
  });
});

// Every new Purchase Order line names a catalog product (see requisitionController.js#buildItems).
const line = (extra = {}) => ({ product: String(catalogProduct._id), description: 'Steel bars', quantity: 10, unitPrice: 100, unit: 'ton', ...extra });

function baseBody(overrides = {}) {
  return {
    vendorId: String(vendor._id),
    project: String(project._id),
    items: [line()],
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
        line({ description: 'Line A', quantity: 2, unitPrice: 50 }), // 100
        line({ description: 'Line B', quantity: 3, unitPrice: 25 }), // 75
      ],
    }),
    user: manager,
  });
  assert.equal(res.body.data.amount, 175);
});

test('createRequisition: a zero-quantity or zero-price item is rejected (never a silently-zero line)', async () => {
  await assert.rejects(() =>
    callHandler(requisitionController.createRequisition, { body: baseBody({ items: [line({ description: 'Bad', quantity: 0, unitPrice: 10 })] }), user: manager })
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
  const req = new Requisition({ vendorId: vendor._id, project: project._id, items: [{ product: catalogProduct._id, description: 'x', quantity: 1, unitPrice: 0.0001 }] });
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

test('createRequisition: a new line must name a catalog product - free text is never a substitute; the description becomes optional notes', async () => {
  await assert.rejects(
    () => callHandler(requisitionController.createRequisition, { body: baseBody({ items: [{ description: 'Steel bars', quantity: 1, unitPrice: 10 }] }), user: manager }),
    /Line 1: select a product or service from the catalog/
  );
  await assert.rejects(
    () => callHandler(requisitionController.createRequisition, { body: baseBody({ items: [line({ product: String(new mongoose.Types.ObjectId()) })] }), user: manager }),
    /does not exist/
  );
  // No notes typed: the line is described by the product's name.
  const res = await callHandler(requisitionController.createRequisition, { body: baseBody({ items: [line({ description: '' })] }), user: manager });
  assert.equal(res.body.data.items[0].description, catalogProduct.title.en);
});

test('updateRequisition: a legacy description-only line stays readable and editable unchanged, but a new free-text line is refused', async () => {
  // A Purchase Order created before the product rule (or CSV-imported) - written directly.
  const legacy = await Requisition.create({ vendorId: vendor._id, project: project._id, items: [{ description: 'Old free-text line', quantity: 2, unitPrice: 50 }] });
  const id = String(legacy._id);

  const kept = await callHandler(requisitionController.updateRequisition, {
    params: { id },
    body: { items: [{ description: 'Old free-text line', quantity: 3, unitPrice: 50 }, line({ quantity: 1, unitPrice: 10 })] },
  });
  assert.equal(kept.body.data.amount, 160);
  assert.equal(kept.body.data.items[0].description, 'Old free-text line');
  assert.equal(kept.body.data.items[0].product, null);

  await assert.rejects(
    () => callHandler(requisitionController.updateRequisition, { params: { id }, body: { items: [{ description: 'A brand new free-text line', quantity: 1, unitPrice: 1 }] } }),
    /select a product or service from the catalog/
  );
});

test('updateRequisition: a draft can be edited (items recomputed); an open one cannot', async () => {
  const created = await callHandler(requisitionController.createRequisition, { body: baseBody(), user: manager });
  const id = String(created.body.data._id);

  const updated = await callHandler(requisitionController.updateRequisition, { params: { id }, body: { items: [line({ description: 'New line', quantity: 1, unitPrice: 500 })] } });
  assert.equal(updated.body.data.amount, 500);

  await callHandler(requisitionController.openRequisition, { params: { id } });
  await assert.rejects(
    () => callHandler(requisitionController.updateRequisition, { params: { id }, body: { items: [line({ description: 'x', quantity: 1, unitPrice: 1 })] } }),
    /Only a draft/
  );
});

// ===================== Purchase Order payment terms (client requirement "Vendor Payment Terms and
// Installments") - utils/documentPaymentTerms.js =====================

const create = async body => (await callHandler(requisitionController.createRequisition, { body: baseBody(body), user: manager })).body.data.toJSON();
const day = iso => new Date(`${iso}T00:00:00.000Z`).getTime();

test('payment terms: no terms given -> the vendor default terms are snapshotted; immediate = 100% on the issue date', async () => {
  const immediate = await create({ issueDate: '2026-03-01' });
  assert.equal(immediate.paymentTerms.mode, 'immediate');
  assert.equal(immediate.paymentSchedule.rows.length, 1);
  assert.equal(immediate.paymentSchedule.rows[0].amount, 1000);
  assert.equal(new Date(immediate.paymentSchedule.rows[0].dueDate).getTime(), day('2026-03-01'));

  await Vendor.updateOne({ _id: vendor._id }, { $set: { paymentTermsConfig: { kind: 'installments', installments: [{ durationDays: 30, percentage: 40 }, { durationDays: 60, percentage: 60 }] } } });
  const fromVendor = await create({ issueDate: '2026-03-01' });
  assert.equal(fromVendor.paymentTerms.mode, 'installments');
  assert.deepEqual(fromVendor.paymentSchedule.rows.map(r => [r.percentage, r.amount, r.tenorDays]), [[40, 400, 30], [60, 600, 60]]);
});

test('payment terms: three installments (percentage and fixed amount) each have a description, tenor from the PO issue date and due date; the remainder is unallocated', async () => {
  const po = await create({
    issueDate: '2026-04-01',
    paymentTerms: {
      mode: 'installments',
      installments: [
        { description: 'Advance', basis: 'percentage', percentage: 30, tenorDays: 0 },
        { description: 'On delivery', basis: 'amount', amount: 250, tenorDays: 30 },
        { description: 'Retention', basis: 'percentage', percentage: 10, tenorDays: 90 },
      ],
    },
  });
  const { rows, allocatedAmount, allocatedPercentage, unallocatedAmount } = po.paymentSchedule;
  assert.deepEqual(rows.map(r => r.description), ['Advance', 'On delivery', 'Retention']);
  assert.deepEqual(rows.map(r => r.amount), [300, 250, 100]);
  assert.deepEqual(rows.map(r => new Date(r.dueDate).getTime()), [day('2026-04-01'), day('2026-05-01'), day('2026-06-30')]);
  assert.equal(allocatedAmount, 650);
  assert.equal(allocatedPercentage, 65);
  assert.equal(unallocatedAmount, 350);
  assert.equal(await JournalEntry.countDocuments({}), 0, 'a payment schedule never posts anything');
});

test('payment terms: allocations above 100% or above the PO value, missing descriptions, negative values and a lump-sum date before the issue date are refused', async () => {
  const bad = paymentTerms => assert.rejects(() => callHandler(requisitionController.createRequisition, { body: baseBody({ issueDate: '2026-04-01', paymentTerms }), user: manager }));
  const row = extra => ({ description: 'Part', basis: 'percentage', percentage: 50, tenorDays: 30, ...extra });
  await bad({ mode: 'installments', installments: [row(), row({ percentage: 60 })] });
  await bad({ mode: 'installments', installments: [row({ basis: 'amount', amount: 900, percentage: undefined }), row({ basis: 'amount', amount: 200, percentage: undefined })] });
  await bad({ mode: 'installments', installments: [row({ description: '  ' })] });
  await bad({ mode: 'installments', installments: [row({ percentage: -5 })] });
  await bad({ mode: 'installments', installments: [row({ tenorDays: -1 })] });
  await bad({ mode: 'installments', installments: [] });
  await bad({ mode: 'lump_sum', lumpSumDueDate: '2026-03-01' });
  await bad({ mode: 'weekly' });
  assert.equal(await Requisition.countDocuments({}), 0, 'nothing is saved for an invalid schedule');

  const lump = await create({ issueDate: '2026-04-01', paymentTerms: { mode: 'lump_sum', lumpSumDueDate: '2026-06-15' } });
  assert.deepEqual(lump.paymentSchedule.rows.map(r => [r.percentage, r.amount, r.tenorDays]), [[100, 1000, 75]]);
});

test('payment terms: rounding - 100% in percentages reconciles to the cent (last row absorbs it); a PO value change recalculates percentages but cannot push fixed amounts over the value', async () => {
  const thirds = { mode: 'installments', installments: [1, 2, 3].map(i => ({ description: `Third ${i}`, basis: 'percentage', percentage: 33.3333, tenorDays: i * 30 })) };
  thirds.installments[2].percentage = 33.3334;
  const po = await create({ items: [line({ quantity: 1, unitPrice: 100 })], paymentTerms: thirds });
  assert.deepEqual(po.paymentSchedule.rows.map(r => r.amount), [33.33, 33.33, 33.34]);
  assert.equal(po.paymentSchedule.allocatedAmount, 100);

  const id = String(po._id);
  const raised = (await callHandler(requisitionController.updateRequisition, { params: { id }, body: { items: [line({ quantity: 3, unitPrice: 100 })] } })).body.data.toJSON();
  assert.deepEqual(raised.paymentSchedule.rows.map(r => r.amount), [100, 100, 100], 'percentages follow the new value');

  const fixed = await create({ items: [line({ quantity: 1, unitPrice: 500 })], paymentTerms: { mode: 'installments', installments: [{ description: 'Fixed', basis: 'amount', amount: 400, tenorDays: 10 }] } });
  await assert.rejects(
    () => callHandler(requisitionController.updateRequisition, { params: { id: String(fixed._id) }, body: { items: [line({ quantity: 1, unitPrice: 300 })] } }),
    /more than the total value|cannot exceed 100%/
  );
});
