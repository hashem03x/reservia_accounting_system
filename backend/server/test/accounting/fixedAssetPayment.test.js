const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Fixed asset payments (services/fixedAssets/fixedAssetPaymentService.js): a payment settles the
// acquisition payable - Dr Suppliers (vendor) / Cr the payment account - never re-capitalizes the
// asset, never exceeds what is owed, and stops counting once its entry is reversed. Expected
// figures are worked out by hand: a vehicle of 100,000 + 14% VAT = 114,000 owed to the vendor.

const DB_URI = process.env.TEST_DB_URI_FA_PAYMENTS || 'mongodb://127.0.0.1:27017/reversia_test_fixed_asset_payments';

const { AutomaticJournalAccountCodes: C } = require('../../utils/accountingConstants');

let FixedAsset, ChartOfAccount, JournalEntry, Vendor, Warehouse, Payment;
let createFixedAsset, runDepreciation, recordFixedAssetPayment, getFixedAssetPayments, reverseJournalEntry;
let transactionsSupported = true;
let vendor, otherVendor, warehouse, accounts;
let keySeq = 0;

const idStr = ref => String(ref?._id || ref);
const codeOf = id => Object.keys(accounts).find(key => idStr(accounts[key]) === idStr(id));

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  Warehouse = require('../../models/inventory/warehouseModel');
  Payment = require('../../models/vendor/paymentModel');
  FixedAsset = require('../../models/fixedAssets');
  ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
  JournalEntry = require('../../models/accounting/journalEntryModel');
  Vendor = require('../../models/vendor/vendor');
  ({ createFixedAsset, runDepreciation } = require('../../services/fixedAssets/fixedAssetService'));
  ({ recordFixedAssetPayment, getFixedAssetPayments } = require('../../services/fixedAssets/fixedAssetPaymentService'));
  ({ reverseJournalEntry } = require('../../controller/accounting/journalEntryController'));
  await Promise.all([FixedAsset.init(), ChartOfAccount.init(), JournalEntry.init(), Vendor.init()]);

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

const CHART = {
  vehicles: { code: '12000001', name: 'Vehicles', type: 'asset', parentGroupNameEn: 'Property, Plant & Equipment' },
  accDep: { code: '12000099', name: 'Accumulated Depreciation – Fixed Assets', type: 'asset', parentGroupNameEn: 'Property, Plant & Equipment' },
  software: { code: '13000001', name: 'Software Licenses', type: 'asset', parentGroupNameEn: 'Intangible Assets' },
  accAmort: { code: '13000099', name: 'Accumulated Amortization - Intangible Assets', type: 'asset', parentGroupNameEn: 'Intangible Assets' },
  depExpense: { code: '62000001', name: 'Depreciation & Amortization', type: 'expense', parentGroupNameEn: 'Operating Expenses' },
  cash: { code: '11000001', name: 'Bank Misr', type: 'asset', parentGroupNameEn: 'Cash & Cash Equivalents' },
  safe: { code: '11000002', name: 'Main Safe', type: 'asset', parentGroupNameEn: 'Cash & Cash Equivalents' },
  rent: { code: '61000001', name: 'Office Rent', type: 'expense' },
  suppliers: { code: C.suppliers, name: 'Suppliers', type: 'liability' },
  inputVat: { code: C.inputVat, name: 'Input VAT', type: 'asset' },
};

beforeEach(async () => {
  await Promise.all([FixedAsset, ChartOfAccount, JournalEntry, Vendor, Warehouse, Payment].map(M => M.deleteMany({})));
  accounts = {};
  for (const [key, data] of Object.entries(CHART)) accounts[key] = await ChartOfAccount.create(data);
  vendor = await Vendor.create({ name: 'Auto Dealer', contact: { phone: `010${Date.now()}`.slice(0, 11) } });
  otherVendor = await Vendor.create({ name: 'Other Co', contact: { phone: `011${Date.now()}`.slice(0, 11) } });
  warehouse = await Warehouse.create({ name: 'Head Office', location: 'Cairo', balance: 500000 });
});

async function inTx(work) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } finally {
    session.endSession();
  }
}

const VEHICLE = (overrides = {}) => ({
  name: 'Delivery Truck',
  vendor: vendor._id,
  assetAccountId: accounts.vehicles._id,
  accumulatedAccountId: accounts.accDep._id,
  depreciationAccountId: accounts.depExpense._id,
  acquisitionDate: new Date('2026-01-15'),
  price: 100000,
  usefulLifeMonths: 50,
  vatPercentage: 14,
  ...overrides,
});
const SOFTWARE = (overrides = {}) => VEHICLE({ name: 'ERP License', assetAccountId: accounts.software._id, accumulatedAccountId: accounts.accAmort._id, price: 36000, usefulLifeMonths: 36, vatPercentage: 0, ...overrides });
const create = data => inTx(session => createFixedAsset(data, null, session));
const pay = (asset, data = {}) =>
  inTx(session => recordFixedAssetPayment(asset._id, { paymentAccount: accounts.cash._id, warehouseId: warehouse._id, date: '2026-02-01', requestKey: `key-${++keySeq}-${Date.now()}`, ...data }, null, session));
const summary = async asset => (await getFixedAssetPayments(asset._id)).summary;
const linesOf = entry => entry.lines.map(l => [codeOf(l.account), l.debit, l.credit]);
const vendorBalance = async () => (await Vendor.findById(vendor._id).lean()).balance;
// Suppliers balance (credit - debit) for the vendor's lines, from posted and reversed entries.
async function suppliersPayable() {
  const [row] = await JournalEntry.aggregate([
    { $match: { status: { $in: ['posted', 'reversed'] } } },
    { $unwind: '$lines' },
    { $match: { 'lines.account': accounts.suppliers._id, 'lines.partyNumber': vendor.vendorNumber } },
    { $group: { _id: null, credit: { $sum: '$lines.credit' }, debit: { $sum: '$lines.debit' } } },
  ]);
  return Math.round(((row?.credit || 0) - (row?.debit || 0)) * 100) / 100;
}
async function reverse(entryId, reversalDate = '2026-03-01') {
  let status;
  let error = null;
  await reverseJournalEntry({ params: { id: String(entryId) }, body: { reversalDate: new Date(reversalDate) }, user: { _id: new mongoose.Types.ObjectId() } }, { status: s => ((status = s), { json: () => null }) }, err => (error = err));
  if (error) throw error;
  return status;
}

test('an asset with no payments: the full cost + VAT is outstanding and unpaid; viewing posts nothing', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  const asset = await create(VEHICLE());
  const before = await JournalEntry.countDocuments({});
  const view = await getFixedAssetPayments(asset._id);
  assert.deepEqual(view.summary, { acquisitionCost: 100000, vatAmount: 14000, payable: 114000, totalPaid: 0, outstanding: 114000, status: 'unpaid', review: null, currency: 'EGP' });
  assert.deepEqual(view.payments, []);
  assert.equal(view.asset.assetClass, 'tangible');
  assert.equal(await JournalEntry.countDocuments({}), before, 'opening the Payments tab never posts an entry');
});

test('a partial payment: Dr Suppliers (vendor) / Cr the payment account - the asset is not capitalized again', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  const asset = await create(VEHICLE());
  await pay(asset, { amount: 40000, reference: 'CHQ-118', notes: 'First instalment' });

  const entry = await JournalEntry.findOne({ accountingAction: 'FIXED_ASSET_PAYMENT_RECORDED' }).lean();
  assert.deepEqual(linesOf(entry), [
    ['suppliers', 40000, 0],
    ['cash', 0, 40000],
  ]);
  assert.equal(entry.totalDebit, entry.totalCredit, 'balanced');
  assert.equal(entry.module, 'Fixed Asset');
  assert.equal(entry.status, 'posted');
  assert.deepEqual(new Date(entry.date).toISOString().slice(0, 10), '2026-02-01', 'dated on the payment date');
  assert.ok(entry.lines.every(l => l.partyType === 'vendor' && l.partyNumber === vendor.vendorNumber), 'the Vendor Number is the Sub Account of every line');
  assert.equal(await JournalEntry.countDocuments({ 'lines.account': accounts.vehicles._id }), 1, 'only the acquisition entry touches the asset account');

  const payment = await Payment.findOne({}).lean();
  assert.equal(payment.paymentCategory, 'fixed-asset');
  assert.equal(String(payment.vendorId), String(vendor._id));
  assert.equal(String(entry.sourceId), String(payment._id), 'the entry is linked to its Payment');

  const view = await getFixedAssetPayments(asset._id);
  assert.deepEqual({ ...view.summary }, { acquisitionCost: 100000, vatAmount: 14000, payable: 114000, totalPaid: 40000, outstanding: 74000, status: 'partially_paid', review: null, currency: 'EGP' });
  const [row] = view.payments;
  assert.equal(row.amount, 40000);
  assert.equal(row.status, 'posted');
  assert.equal(row.reference, 'CHQ-118');
  assert.equal(row.journalEntry.entryNumber, entry.entryNumber);
  assert.equal(row.paymentAccount.code, '11000001');
  assert.equal(row.vendor.name, 'Auto Dealer');
  assert.equal(await vendorBalance(), 74000);
  assert.equal(await suppliersPayable(), 74000, 'the outstanding amount equals the vendor payable in the ledger');
});

test('several partial payments, then the remaining balance: fully paid, and nothing more can be paid', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  const asset = await create(VEHICLE({ price: 1000, vatPercentage: 14 })); // 1,140 owed
  await pay(asset, { amount: 333.33, date: '2026-02-01' });
  await pay(asset, { amount: 333.33, date: '2026-02-15', paymentAccount: accounts.safe._id });
  assert.equal((await summary(asset)).outstanding, 473.34);
  await pay(asset, { amount: 473.34, date: '2026-03-01' });

  const s = await summary(asset);
  assert.equal(s.totalPaid, 1140);
  assert.equal(s.outstanding, 0, 'no artificial rounding remainder');
  assert.equal(s.status, 'paid');
  await assert.rejects(() => pay(asset, { amount: 0.01 }), /fully paid/);
  const history = (await getFixedAssetPayments(asset._id)).payments;
  assert.deepEqual(history.map(p => p.amount), [473.34, 333.33, 333.33], 'newest first');
  assert.equal(await JournalEntry.countDocuments({ accountingAction: 'FIXED_ASSET_PAYMENT_RECORDED' }), 3, 'one entry per payment');
  assert.equal(await suppliersPayable(), 0);
});

test('a single full payment settles the payable', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  const asset = await create(VEHICLE());
  await pay(asset, { amount: 114000 });
  assert.equal((await summary(asset)).status, 'paid');
  assert.equal(await vendorBalance(), 0);
});

test('invalid payments are refused and nothing is recorded', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  const asset = await create(VEHICLE());
  await assert.rejects(() => pay(asset, { amount: 114000.01 }), /exceeds the outstanding amount \(114000\)/);
  await assert.rejects(() => pay(asset, { amount: 0 }), /greater than 0/);
  await assert.rejects(() => pay(asset, { amount: -5 }), /greater than 0/);
  await assert.rejects(() => pay(asset, { amount: 100, paymentAccount: undefined }), /Payment method is required/);
  await assert.rejects(() => pay(asset, { amount: 100, paymentAccount: accounts.rent._id }), /Cash or Cash Equivalent/);
  await assert.rejects(() => pay(asset, { amount: 100, paymentAccount: accounts.suppliers._id }), /Cash or Cash Equivalent/);
  await assert.rejects(() => pay(asset, { amount: 100, date: undefined }), /Payment date is required/);
  await assert.rejects(() => pay(asset, { amount: 100, date: '2026-01-14' }), /before the asset date/);
  await assert.rejects(() => pay(asset, { amount: 100, vendor: otherVendor._id }), /does not match the asset's vendor/);
  await assert.rejects(() => inTx(session => recordFixedAssetPayment(new mongoose.Types.ObjectId(), { amount: 1 }, null, session)), /Fixed asset not found/);
  assert.equal(await Payment.countDocuments({}), 0);
  assert.equal(await JournalEntry.countDocuments({ accountingAction: 'FIXED_ASSET_PAYMENT_RECORDED' }), 0);
  assert.equal((await summary(asset)).outstanding, 114000);
});

test('an intangible asset is paid the same way, through Suppliers - never a tangible asset account', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  const asset = await create(SOFTWARE());
  const view = await getFixedAssetPayments(asset._id);
  assert.equal(view.asset.assetClass, 'intangible');
  assert.equal(view.summary.payable, 36000);
  await pay(asset, { amount: 6000 });
  const entry = await JournalEntry.findOne({ accountingAction: 'FIXED_ASSET_PAYMENT_RECORDED' }).lean();
  assert.deepEqual(linesOf(entry), [
    ['suppliers', 6000, 0],
    ['cash', 0, 6000],
  ]);
  assert.equal((await summary(asset)).outstanding, 30000);
});

test('a repeated submission (same request key) records one payment; concurrent payments cannot overpay', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  const asset = await create(VEHICLE());
  const first = await pay(asset, { amount: 10000, requestKey: 'same-key-123' });
  const again = await pay(asset, { amount: 10000, requestKey: 'same-key-123' });
  assert.equal(first.duplicate, false);
  assert.equal(again.duplicate, true);
  assert.equal(String(again.payment.journalEntry), String(first.payment.journalEntry));
  assert.equal(await Payment.countDocuments({}), 1);

  // Two different requests for the whole remaining 104,000 at the same moment: only one succeeds.
  const outcomes = await Promise.allSettled([pay(asset, { amount: 104000 }), pay(asset, { amount: 104000 })]);
  assert.equal(outcomes.filter(o => o.status === 'fulfilled').length, 1, outcomes.map(o => o.reason?.message).join(' | '));
  assert.equal((await summary(asset)).outstanding, 0);
  assert.equal(await JournalEntry.countDocuments({ accountingAction: 'FIXED_ASSET_PAYMENT_RECORDED' }), 2);
  assert.equal(await suppliersPayable(), 0);

  // The same key sent twice at once also records one payment.
  const other = await create(VEHICLE({ name: 'Van' }));
  await Promise.allSettled([pay(other, { amount: 500, requestKey: 'twin-key-456' }), pay(other, { amount: 500, requestKey: 'twin-key-456' })]);
  assert.equal((await FixedAsset.findById(other._id).lean()).payments.length, 1);
});

test('if the payment entry fails, nothing is recorded (atomic rollback)', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  const asset = await create(VEHICLE());
  const balanceBefore = (await Warehouse.findById(warehouse._id).lean()).balance;
  const originalCreate = JournalEntry.create;
  JournalEntry.create = function (docs, ...rest) {
    if (Array.isArray(docs) && docs[0]?.accountingAction === 'FIXED_ASSET_PAYMENT_RECORDED') throw new Error('forced payment entry failure');
    return originalCreate.call(this, docs, ...rest);
  };
  try {
    await assert.rejects(() => pay(asset, { amount: 1000 }), /forced payment entry failure/);
  } finally {
    JournalEntry.create = originalCreate;
  }
  assert.equal(await Payment.countDocuments({}), 0);
  assert.equal((await FixedAsset.findById(asset._id).lean()).payments.length, 0);
  assert.equal(await vendorBalance(), 114000);
  assert.equal((await Warehouse.findById(warehouse._id).lean()).balance, balanceBefore);
});

test('a payment reversed through the journal entry reversal stops counting; it cannot be reversed twice', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  const asset = await create(VEHICLE());
  await pay(asset, { amount: 114000 });
  assert.equal((await summary(asset)).status, 'paid');
  const entry = await JournalEntry.findOne({ accountingAction: 'FIXED_ASSET_PAYMENT_RECORDED' });

  assert.equal(await reverse(entry._id), 201);
  const view = await getFixedAssetPayments(asset._id);
  assert.equal(view.summary.totalPaid, 0);
  assert.equal(view.summary.outstanding, 114000);
  assert.equal(view.summary.status, 'unpaid');
  assert.equal(view.payments.length, 1, 'the reversed payment stays in the history');
  assert.equal(view.payments[0].status, 'reversed');
  assert.ok(view.payments[0].reversalEntry.entryNumber > entry.entryNumber);
  assert.equal(await suppliersPayable(), 114000, 'the ledger payable is back too');
  await assert.rejects(() => reverse(entry._id), /Only posted journal entries can be reversed|already been reversed/);

  // It can be paid again.
  await pay(asset, { amount: 50000, date: '2026-03-05' });
  assert.equal((await summary(asset)).outstanding, 64000);
});

test('assets without a reliable acquisition payable are flagged and cannot be paid', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  // An asset created before the Fixed Assets module: no acquisition entry, no payable.
  const legacy = await FixedAsset.create({ name: 'Old Printer', vendor: vendor._id, price: 5000, bookValue: 5000 });
  const view = await getFixedAssetPayments(legacy._id);
  assert.equal(view.summary.payable, null);
  assert.equal(view.summary.status, 'not_applicable');
  assert.match(view.summary.review, /no acquisition journal entry/);
  await assert.rejects(() => pay(legacy, { amount: 100 }), /no acquisition journal entry/);

  // An asset whose acquisition entry was reversed: nothing is owed.
  const reversed = await create(VEHICLE({ name: 'Cancelled Truck' }));
  await reverse(reversed.acquisitionJournalEntry, '2026-01-20');
  const s = await summary(reversed);
  assert.equal(s.payable, 0);
  assert.equal(s.status, 'not_applicable');
  await assert.rejects(() => pay(reversed, { amount: 100 }), /has been reversed/);

  // No vendor at all.
  const noVendor = await FixedAsset.create({ name: 'Gift', price: 100, bookValue: 100 });
  await assert.rejects(() => pay(noVendor, { amount: 1 }), /no vendor/);
  assert.equal(await Payment.countDocuments({}), 0);
});

test('payments do not affect depreciation or the asset values', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  const asset = await create(VEHICLE());
  await pay(asset, { amount: 14000 });
  await inTx(session => runDepreciation({ period: '2026-01', userId: null }, session));
  const stored = await FixedAsset.findById(asset._id).lean();
  assert.equal(stored.price, 100000);
  assert.equal(stored.accumulatedDepreciation, 2000);
  assert.equal(stored.bookValue, 98000);
  assert.equal(stored.payments.length, 1);
  assert.equal((await summary(asset)).outstanding, 100000);
});

test('payment routes: read needs the read permission, recording needs create; both behind sign-in', async () => {
  const router = require('../../routes/fixedAssetRoute');
  const authController = require('../../controller/user/authController');
  assert.equal(router.stack[0].handle, authController.protect);
  const layer = router.stack.find(l => l.route?.path === '/:id/payments');
  assert.ok(layer, 'GET/POST /fixed-assets/:id/payments');
  const call = (handler, user) => new Promise(resolve => handler({ user }, {}, err => resolve(err || null)));
  const [getLayer, postLayer] = [layer.route.stack.find(s => s.method === 'get'), layer.route.stack.find(s => s.method === 'post')];
  const readOnly = { role: 'user', permissions: [{ resource: 'expenses', actions: ['read'] }] };
  assert.equal(await call(getLayer.handle, readOnly), null);
  assert.equal((await call(postLayer.handle, readOnly))?.statusCode, 403, 'read-only users cannot post payments');
  assert.equal((await call(getLayer.handle, { role: 'user', permissions: [] }))?.statusCode, 403);
  assert.equal(await call(postLayer.handle, { role: 'user', permissions: [{ resource: 'expenses', actions: ['read', 'create'] }] }), null);
});
