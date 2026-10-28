const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Client requirements "Projects - Customer Payment Terms" and "Purchase Orders - Vendor Payment
// Terms and Installments": the shared document payment-terms rules (utils/documentPaymentTerms.js),
// project customer terms saved/loaded through the real updateProject handler, and the cash-flow
// forecast using terms only for documents nothing has been invoiced against yet.

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_customer_payment_terms';
const T = require('../../utils/documentPaymentTerms');

let Project, User, Vendor, Requisition, JournalEntry, Payment, updateProject, forecast;
let manager, customer, vendor;

const day = iso => new Date(`${iso}T00:00:00.000Z`).getTime();

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
    Promise.resolve(handler({ headers: {}, query: {}, body: {}, params: {}, user: manager, ...req }, res, err => (err ? reject(err) : resolve({ status: res.statusCode })))).catch(reject);
  });
}

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  Project = require('../../models/project/projectModel');
  User = require('../../models/userModel');
  Vendor = require('../../models/vendor/vendor');
  require('../../models/inventory/productModel'); // populated by the Requisition find hook
  Requisition = require('../../models/vendor/requisitionModel');
  JournalEntry = require('../../models/accounting/journalEntryModel');
  Payment = require('../../models/vendor/paymentModel');
  ({ updateProject } = require('../../controller/project/projectController'));
  forecast = require('../../services/cashflow/cashFlowForecastService');
  await Promise.all([Project.init(), User.init(), Requisition.init()]);
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

let seq = 0;
beforeEach(async () => {
  await Promise.all(['projects', 'users', 'vendors', 'requisitions', 'journalentries', 'payments', 'salesorders', 'purchaseorders', 'counters'].map(c => mongoose.connection.collection(c).deleteMany({})));
  seq += 1;
  manager = await User.create({ name: 'Terms Manager', email: `terms-mgr-${seq}@example.com`, role: 'admin', type: 'online' });
  customer = await User.create({ name: 'Terms Customer', email: `terms-cust-${seq}@example.com`, role: 'user', type: 'online' });
  vendor = await Vendor.create({ name: 'Terms Vendor', contact: { phone: `011${Date.now()}${seq}`.slice(0, 11) } });
});

const newProject = extra =>
  Project.create({ projectNumber: `TRM-${seq}-${Math.random().toString(36).slice(2, 6)}`, projectManager: manager._id, customer: customer._id, contractValue: 1000000, startDate: new Date('2026-01-01'), deliveryDate: new Date('2026-12-31'), ...extra });

// ---------------------------------------------------------------- pure rules

test('rules: immediate, lump sum and installments; under-allocation is allowed and reported, over-allocation never', () => {
  assert.equal(T.validateDocumentPaymentTerms(null), null, 'not set is valid');
  assert.equal(T.validateDocumentPaymentTerms({ mode: 'immediate' }, { total: 100 }), null);
  assert.match(T.validateDocumentPaymentTerms({ mode: 'lump_sum' }, { total: 100 }), /due date/);
  const partial = { mode: 'installments', installments: [{ description: 'Advance', basis: 'percentage', percentage: 20, tenorDays: 0 }] };
  assert.equal(T.validateDocumentPaymentTerms(partial, { total: 100 }), null);
  const s = T.computeDocumentPaymentSchedule(partial, { total: 100, issueDate: new Date('2026-01-01') });
  assert.deepEqual([s.allocatedAmount, s.allocatedPercentage, s.unallocatedAmount], [20, 20, 80]);
  assert.match(
    T.validateDocumentPaymentTerms({ mode: 'installments', installments: [{ description: 'A', basis: 'amount', amount: 60, tenorDays: 1 }, { description: 'B', basis: 'percentage', percentage: 50, tenorDays: 2 }] }, { total: 100 }),
    /cannot exceed 100%|more than the total/
  );
});

test('rules: a vendor default config becomes document terms (immediate / deferred lump sum / installments)', () => {
  assert.deepEqual(T.termsFromVendorConfig(null), { mode: 'immediate' });
  assert.deepEqual(T.termsFromVendorConfig({ kind: 'lump_sum', lumpSum: { timing: 'immediate' } }), { mode: 'immediate' });
  const deferred = T.termsFromVendorConfig({ kind: 'lump_sum', lumpSum: { timing: 'deferred', durationDays: 30 } }, new Date('2026-02-01'));
  assert.equal(deferred.mode, 'lump_sum');
  assert.equal(deferred.lumpSumDueDate.getTime(), day('2026-03-03'));
  const inst = T.termsFromVendorConfig({ kind: 'installments', installments: [{ durationDays: 0, percentage: 50 }, { durationDays: 30, percentage: 50 }] });
  assert.deepEqual(inst.installments.map(i => [i.description, i.percentage, i.tenorDays]), [['Installment 1', 50, 0], ['Installment 2', 50, 30]]);
});

// ---------------------------------------------------------------- project customer terms

test('project: customer payment terms are saved and loaded with the computed schedule; the contract value is untouched', async () => {
  const project = await newProject();
  const res = await callHandler(updateProject, {
    params: { id: String(project._id) },
    body: {
      customerPaymentTerms: {
        mode: 'installments',
        installments: [
          { description: 'Down payment', basis: 'percentage', percentage: 30, tenorDays: 0 },
          { description: 'Mid-project', basis: 'amount', amount: 400000, tenorDays: 90 },
          { description: 'Handover', basis: 'percentage', percentage: 30, tenorDays: 180 },
        ],
      },
    },
  });
  assert.equal(res.status, 200);
  const json = res.body.data.toJSON();
  assert.equal(json.contractValue, 1000000);
  assert.deepEqual(json.customerPaymentSchedule.rows.map(r => [r.description, r.amount, new Date(r.dueDate).getTime()]), [
    ['Down payment', 300000, day('2026-01-01')],
    ['Mid-project', 400000, day('2026-04-01')],
    ['Handover', 300000, day('2026-06-30')],
  ]);
  assert.equal(json.customerPaymentSchedule.unallocatedAmount, 0);

  const reloaded = (await Project.findById(project._id)).toJSON();
  assert.equal(reloaded.customerPaymentTerms.installments.length, 3);
  assert.equal(await JournalEntry.countDocuments({}), 0, 'terms never post anything');
  assert.equal(await Payment.countDocuments({}), 0, 'terms never create a payment');
});

test('project: invalid terms are refused with a clear error; lowering the contract value below fixed installments is refused', async () => {
  const project = await newProject();
  const id = String(project._id);
  const bad = customerPaymentTerms => assert.rejects(() => callHandler(updateProject, { params: { id }, body: { customerPaymentTerms } }), err => err.statusCode === 400);
  await bad({ mode: 'installments', installments: [{ description: 'Too much', basis: 'percentage', percentage: 120, tenorDays: 0 }] });
  await bad({ mode: 'installments', installments: [{ description: '', basis: 'percentage', percentage: 10, tenorDays: 0 }] });
  await bad({ mode: 'lump_sum', lumpSumDueDate: '2025-12-01' });

  await callHandler(updateProject, { params: { id }, body: { customerPaymentTerms: { mode: 'installments', installments: [{ description: 'Fixed', basis: 'amount', amount: 600000, tenorDays: 30 }] } } });
  await assert.rejects(() => callHandler(updateProject, { params: { id }, body: { contractValue: 500000 } }), err => err.statusCode === 400 && /more than the total value|cannot exceed 100%/.test(err.message));
  assert.equal((await Project.findById(id).lean()).contractValue, 1000000, 'nothing saved');

  const noValue = await newProject({ contractValue: undefined });
  await assert.rejects(
    () => callHandler(updateProject, { params: { id: String(noValue._id) }, body: { customerPaymentTerms: { mode: 'lump_sum', lumpSumDueDate: '2026-02-01' } } }),
    /need the project contract value/
  );
});

// ---------------------------------------------------------------- cash-flow forecast

test('forecast: an un-invoiced project is forecast by its customer terms (an overdue installment is NOT paid); the unallocated part stays unscheduled', async () => {
  const project = await newProject({
    customerPaymentTerms: { mode: 'installments', installments: [{ description: 'Advance', basis: 'percentage', percentage: 25, tenorDays: 0 }, { description: 'Later', basis: 'percentage', percentage: 25, tenorDays: 400 }] },
  });
  const { scheduled, unscheduled } = await forecast.getCustomerInflowObligations({ projectIds: [project._id] });
  assert.deepEqual(scheduled.map(s => [s.installment, s.amount]), [['Advance', 250000], ['Later', 250000]]);
  assert.equal(scheduled[0].status, 'overdue', 'a past due date is overdue - never paid');
  assert.deepEqual(unscheduled.map(u => [u.amount, u.reason]), [[500000, 'uninvoiced_contract_remainder']]);
});

test('forecast: an open, un-invoiced Purchase Order is forecast by its terms; a draft or partly invoiced one keeps the existing unscheduled commitment (no double counting)', async () => {
  const project = await newProject();
  const make = extra =>
    Requisition.create({
      vendorId: vendor._id,
      project: project._id,
      items: [{ description: 'Steel', quantity: 1, unitPrice: 1000 }],
      issueDate: new Date('2026-03-01'),
      paymentTerms: { mode: 'installments', installments: [{ description: 'Advance', basis: 'percentage', percentage: 40, tenorDays: 0 }, { description: 'Balance', basis: 'percentage', percentage: 60, tenorDays: 60 }] },
      ...extra,
    });
  const open = await make({ status: 'open' });
  const draft = await make({ status: 'draft' });
  const partly = await make({ status: 'open', invoicedAmount: 100 });

  const { scheduled, unscheduled } = await forecast.getVendorOutflowObligations({ projectIds: [project._id] });
  const ofReq = (list, req) => list.filter(l => String(l.sourceId) === String(req._id));
  assert.deepEqual(ofReq(scheduled, open).map(l => [l.installment, l.amount, l.date.getTime()]), [['Advance', 400, day('2026-03-01')], ['Balance', 600, day('2026-04-30')]]);
  assert.deepEqual(ofReq(unscheduled, open), []);
  assert.deepEqual(ofReq(scheduled, draft), []);
  assert.deepEqual(ofReq(unscheduled, draft).map(l => [l.amount, l.status]), [[1000, 'draft']]);
  assert.deepEqual(ofReq(scheduled, partly), []);
  assert.deepEqual(ofReq(unscheduled, partly).map(l => [l.amount, l.reason]), [[900, 'uninvoiced_po_commitment']]);
});

// ---------------------------------------------------------------- project BOQ lines

test('project BOQ lines: saved and loaded with their product; one line per product; physical products only; price required and never negative; currency must be configured', async () => {
  const Product = mongoose.model('Product');
  const base = { description: { en: 'd', ar: 'د' }, category: new mongoose.Types.ObjectId(), brand: new mongoose.Types.ObjectId() };
  const cable = await Product.create({ ...base, type: 'product', title: { en: `BOQ Cable ${seq}`, ar: `كابل ${seq}` } });
  const service = await Product.create({ type: 'service', title: { en: `BOQ Service ${seq}`, ar: `خدمة ${seq}` }, description: base.description, durationValue: 1 });
  const project = await newProject();
  const id = String(project._id);
  const save = boqLines => callHandler(updateProject, { params: { id }, body: { boqLines } });
  const refused = (boqLines, pattern) => assert.rejects(() => save(boqLines), err => err.statusCode === 400 && pattern.test(err.message));

  const ok = await save([{ product: String(cable._id), quantity: 30, unit: 'm', unitPrice: 100 }]);
  const line = ok.body.data.toJSON().boqLines[0];
  assert.equal(line.product.title.en, cable.title.en, 'populated product');
  assert.deepEqual([line.quantity, line.unit, line.unitPrice, line.currency], [30, 'm', 100, 'EGP']);

  await refused([{ product: String(cable._id), quantity: 1, unitPrice: 1 }, { product: String(cable._id), quantity: 2, unitPrice: 2 }], /already in the BOQ/);
  await refused([{ product: String(service._id), quantity: 1, unitPrice: 1 }], /is a service/);
  await refused([{ product: String(cable._id), quantity: 1, unitPrice: -1 }], /cannot be negative/);
  await refused([{ product: String(cable._id), quantity: 1 }], /unit price is required/);
  await refused([{ product: String(cable._id), quantity: 1, unitPrice: 5, currency: 'XYZ' }], /not a configured currency/);
  assert.equal((await Project.findById(id).lean()).boqLines.length, 1, 'refused changes are not saved');
});
