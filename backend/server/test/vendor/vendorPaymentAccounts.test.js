const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const os = require('os');
const path = require('path');
const fs = require('fs').promises;
const { validationResult } = require('express-validator');

// Client requirement "Vendors - Multiple Bank Accounts, InstaPay Accounts, and Wallets": several
// payment (settlement) accounts per vendor (utils/vendorPaymentAccounts.js), managed through the
// vendor API, referenced by vendor payments as a snapshot, imported from CSV and migrated from the
// old single paymentInfo / bankInfo.

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_vendor_payment_accounts';
const A = require('../../utils/vendorPaymentAccounts');

let Vendor, createVendorValidators, updateVendorValidators, previewImport, commitImport, vendorSchema, migrateVendorPaymentAccounts;

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  Vendor = require('../../models/vendor/vendor');
  ({ createVendorValidators, updateVendorValidators } = require('../../utils/validators/vendorValidators'));
  ({ previewImport, commitImport } = require('../../services/csvImport/csvImportRunner'));
  vendorSchema = require('../../utils/validators/import/vendorImportSchema');
  ({ migrateVendorPaymentAccounts } = require('../../scripts/migrateVendorPaymentAccounts'));
  await Vendor.init();
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  await Promise.all(['vendors', 'payments', 'counters'].map(c => mongoose.connection.collection(c).deleteMany({})));
});

const IBAN = 'EG380019000500000000263180099';
const bank = (extra = {}) => ({ type: 'bank', bank: { bankName: 'Banque Misr', accountNumber: '1234567890123', accountHolderName: 'Nile Co' }, ...extra });
const instapay = (id = 'nile@instapay', extra = {}) => ({ type: 'instapay', instapay: { identifier: id }, ...extra });
const wallet = (number = '01012345678', extra = {}) => ({ type: 'wallet', wallet: { provider: 'vodafone_cash', identifier: number }, ...extra });

async function runValidators(validators, body, params = {}) {
  const req = { body, params, query: {} };
  for (const v of validators) if (typeof v.run === 'function') await v.run(req);
  return { req, errors: validationResult(req).array().map(e => e.msg) };
}

// ---------------------------------------------------------------- rules

test('rules: several accounts of each type; one primary (default to the first active); fields per type; no duplicates', () => {
  const { accounts, error } = A.normalizeVendorPaymentAccounts([bank(), bank({ bank: { bankName: 'NBE', iban: IBAN } }), instapay(), instapay('other@instapay'), wallet(), wallet('01198765432')]);
  assert.equal(error, null);
  assert.equal(accounts.length, 6);
  assert.deepEqual(accounts.map(a => a.isPrimary), [true, false, false, false, false, false]);
  assert.equal(accounts[0].instapay, undefined, 'only the fields of its own type are kept');

  const err = list => A.normalizeVendorPaymentAccounts(list).error;
  assert.match(err([bank({ bank: { bankName: 'X' } })]), /account number or IBAN/);
  assert.match(err([bank({ bank: { bankName: 'X', iban: 'GB00' } })]), /Egyptian IBAN/);
  assert.match(err([instapay('')]), /InstaPay identifier/);
  assert.match(err([{ type: 'wallet', wallet: { provider: 'paypal', identifier: '1' } }]), /provider/);
  assert.match(err([wallet(), wallet()]), /listed twice/);
  assert.match(err([bank({ isPrimary: true }), instapay(undefined, { isPrimary: true })]), /Only one/);
  assert.match(err([{ type: 'cheque' }]), /type/);

  // An inactive account is never the primary.
  const inactive = A.normalizeVendorPaymentAccounts([bank({ isPrimary: true, isActive: false }), instapay()]).accounts;
  assert.deepEqual(inactive.map(a => [a.isActive, a.isPrimary]), [[false, false], [true, true]]);
  assert.deepEqual(A.paymentInfoFromAccounts(inactive), { mode: 'instapay', instapay: { identifier: 'nile@instapay' } });
  assert.equal(A.describeAccount(accounts[0]), 'Bank - Banque Misr ****0123', 'masked');
});

// ---------------------------------------------------------------- API (validators + model)

test('create: accounts are validated, normalized and paymentInfo follows the primary account', async () => {
  const body = { name: 'Nile Supplies', contact: { phone: '01123456789', email: 'nile@example.com' }, paymentAccounts: [instapay(), bank({ isPrimary: true }), wallet()] };
  const { req, errors } = await runValidators(createVendorValidators, body);
  assert.deepEqual(errors, []);
  assert.equal(req.body.paymentInfo.mode, 'bank');
  const vendor = await Vendor.create(req.body);
  assert.equal(vendor.paymentAccounts.length, 3);
  assert.ok(vendor.paymentAccounts.every(a => a._id), 'every account has its own id');
  assert.equal(vendor.paymentInfo.mode, 'bank');

  const bad = await runValidators(createVendorValidators, { ...body, paymentAccounts: [instapay(), instapay()] });
  assert.ok(bad.errors.some(m => /listed twice/.test(m)));
});

test('update: edit, add, deactivate - ids are kept; an account a payment was sent to cannot be deleted; a foreign id is refused', async () => {
  const vendor = await Vendor.create({ name: 'Delta Trading', contact: { phone: '01223456789' }, paymentAccounts: [bank(), instapay()] });
  const [bankAcc, instaAcc] = vendor.paymentAccounts.map(a => a.toObject());
  const params = { id: String(vendor._id) };

  // Edit the bank, add a wallet, deactivate InstaPay.
  const edit = await runValidators(updateVendorValidators, { paymentAccounts: [{ ...bankAcc, label: 'Main' }, { ...instaAcc, isActive: false }, wallet()] }, params);
  assert.deepEqual(edit.errors, []);
  await Vendor.findByIdAndUpdate(vendor._id, { $set: edit.req.body }, { new: true });
  const updated = await Vendor.findById(vendor._id).lean();
  assert.equal(String(updated.paymentAccounts[0]._id), String(bankAcc._id), 'the id survives the edit');
  assert.equal(updated.paymentAccounts[0].label, 'Main');
  assert.equal(updated.paymentAccounts[1].isActive, false);
  assert.equal(updated.paymentAccounts.length, 3);

  // A payment points at the bank account -> it can no longer be removed (deactivating is fine).
  await mongoose.connection.collection('payments').insertOne({ vendorId: vendor._id, vendorPaymentAccount: { accountId: bankAcc._id, type: 'bank' } });
  const remove = await runValidators(updateVendorValidators, { paymentAccounts: updated.paymentAccounts.slice(1) }, params);
  assert.ok(remove.errors.some(m => /cannot be deleted - deactivate it instead/.test(m)));
  const removeUnused = await runValidators(updateVendorValidators, { paymentAccounts: [updated.paymentAccounts[0], updated.paymentAccounts[2]] }, params);
  assert.deepEqual(removeUnused.errors, [], 'an account no payment uses can be deleted');

  const foreign = await runValidators(updateVendorValidators, { paymentAccounts: [{ ...bank(), _id: String(new mongoose.Types.ObjectId()) }] }, params);
  assert.ok(foreign.errors.some(m => /does not belong to this vendor/.test(m)));
});

// ---------------------------------------------------------------- CSV import

test('import: the PaymentMode columns are the primary account and AdditionalPaymentAccounts adds more; a bad entry is a clear row error', async () => {
  const header = 'Name,Phone,Email,PaymentMode,PaymentBankName,PaymentBankAccountNumber,AdditionalPaymentAccounts';
  const write = async content => {
    const file = path.join(os.tmpdir(), `vendor-accounts-${Date.now()}-${Math.random().toString(36).slice(2)}.csv`);
    await fs.writeFile(file, Buffer.from(content, 'utf8'));
    return { path: file };
  };
  const good = `${header}\nNile Supplies,01123456789,nile@example.com,bank,Banque Misr,1234567890123,instapay|nile@instapay ; wallet|vodafone_cash|01012345678 ; bank|NBE||${IBAN}\n`;
  const { created } = await commitImport(await write(good), vendorSchema);
  assert.equal(created.length, 1);
  const vendor = await Vendor.findOne({ name: 'Nile Supplies' }).lean();
  assert.deepEqual(vendor.paymentAccounts.map(a => [a.type, a.isPrimary]), [['bank', true], ['instapay', false], ['wallet', false], ['bank', false]]);
  assert.equal(vendor.paymentInfo.mode, 'bank');

  const bad = await previewImport(await write(`${header}\nDelta Co,01223456789,delta@example.com,,,,cheque|123 ; wallet|vodafone_cash|\n`), vendorSchema);
  assert.equal(bad.validCount, 0);
  const messages = bad.errors.flatMap(r => r.errors.map(e => `${e.column}: ${e.message}`));
  assert.ok(messages.some(m => /AdditionalPaymentAccounts: Entry 1/.test(m)), JSON.stringify(messages));
});

// ---------------------------------------------------------------- migration

test('migration: legacy paymentInfo / bankInfo become accounts (selected mode = primary), only for vendors without accounts; idempotent; nothing else changes', async () => {
  const col = mongoose.connection.collection('vendors');
  await col.insertMany([
    { name: 'Legacy Bank', vendorNumber: 1, contact: { phone: '01000000001' }, paymentInfo: { mode: 'wallet', wallet: { provider: 'orange_cash', identifier: '01212345678' }, bank: { bankName: 'CIB', accountNumber: '555000111' } }, bankInfo: { bankName: 'CIB', accountNumber: '555000111' } },
    { name: 'Incomplete', vendorNumber: 2, contact: { phone: '01000000002' }, paymentInfo: { mode: 'bank', bank: { bankName: 'QNB' } } },
    { name: 'Already Migrated', vendorNumber: 3, contact: { phone: '01000000003' }, paymentInfo: { mode: 'instapay', instapay: { identifier: 'x@instapay' } }, paymentAccounts: [{ _id: new mongoose.Types.ObjectId(), type: 'bank', isPrimary: true, isActive: true, bank: { bankName: 'HSBC', accountNumber: '1' } }] },
    { name: 'Nothing', vendorNumber: 4, contact: { phone: '01000000004' } },
  ]);
  const before = await col.findOne({ name: 'Legacy Bank' });

  const dry = await migrateVendorPaymentAccounts({ dryRun: true, connect: false, log: () => {} });
  assert.equal(dry.migrated, 1);
  assert.equal((await col.findOne({ name: 'Legacy Bank' })).paymentAccounts, undefined, 'a dry run writes nothing');

  const run = await migrateVendorPaymentAccounts({ dryRun: false, connect: false, log: () => {} });
  assert.deepEqual([run.migrated, run.accountsCreated, run.skipped.length, run.nothingToMigrate], [1, 2, 1, 1]);
  const migrated = await col.findOne({ name: 'Legacy Bank' });
  assert.deepEqual(migrated.paymentAccounts.map(a => [a.type, a.isPrimary]), [['bank', false], ['wallet', true]], 'bankInfo duplicate of paymentInfo.bank collapsed; selected mode is primary');
  assert.deepEqual(migrated.paymentInfo, before.paymentInfo, 'legacy fields untouched');
  assert.deepEqual(migrated.bankInfo, before.bankInfo);
  assert.equal((await col.findOne({ name: 'Already Migrated' })).paymentAccounts.length, 1, 'vendors with accounts are never touched');

  const again = await migrateVendorPaymentAccounts({ dryRun: false, connect: false, log: () => {} });
  assert.equal(again.migrated, 0, 'idempotent');
});

// ---------------------------------------------------------------- vendor payment -> payee account

test('a vendor payment can only name an ACTIVE account of the invoice\'s own vendor (refused before anything is posted)', async t => {
  const probe = await mongoose.startSession();
  try {
    await probe.withTransaction(async () => {});
  } catch (e) {
    return t.skip('needs a replica set (transactions)');
  } finally {
    probe.endSession();
  }
  require('../../models/inventory/productModel');
  const Warehouse = require('../../models/inventory/warehouseModel');
  const Project = require('../../models/project/projectModel');
  const User = require('../../models/userModel');
  const Requisition = require('../../models/vendor/requisitionModel');
  const PurchaseOrder = require('../../models/vendor/purchaseOrder');
  const Payment = require('../../models/vendor/paymentModel');
  const { createPurchasePayment } = require('../../controller/PO/PaymentController');
  // Indexes built before the transaction runs (an index build racing a transaction can fail it).
  await Promise.all([Warehouse.init(), Project.init(), User.init(), Requisition.init(), PurchaseOrder.init(), Payment.init(), mongoose.model('Product').init()]);

  const manager = await User.create({ name: 'Pay Manager', email: `pay-${Date.now()}@example.com`, role: 'admin', type: 'online' });
  const warehouse = await Warehouse.create({ name: `Pay WH ${Date.now()}`, location: 'Cairo' });
  const project = await Project.create({ projectNumber: `PAY-${Date.now()}`, projectManager: manager._id, startDate: new Date('2026-01-01'), deliveryDate: new Date('2026-12-31') });
  const vendor = await Vendor.create({ name: 'Payee Vendor', contact: { phone: '01511111111' }, paymentAccounts: [bank(), instapay(undefined, { isActive: false })] });
  const other = await Vendor.create({ name: 'Another Vendor', contact: { phone: '01522222222' }, paymentAccounts: [wallet()] });
  const requisition = await Requisition.create({ vendorId: vendor._id, project: project._id, status: 'open', items: [{ description: 'x', quantity: 1, unitPrice: 100000 }] });
  const product = await mongoose.model('Product').create({ type: 'product', title: { en: `Pay item ${Date.now()}`, ar: `بند ${Date.now()}` }, description: { en: 'd', ar: 'د' }, category: new mongoose.Types.ObjectId(), brand: new mongoose.Types.ObjectId() });
  const invoice = await PurchaseOrder.create({ vendorId: vendor._id, warehouseId: warehouse._id, project: project._id, requisition: requisition._id, items: [{ productId: product._id, unitPrice: 100, starterQuantity: 10 }] });

  const pay = account =>
    new Promise(resolve => {
      const res = { status: () => res, json: body => resolve({ ok: true, body }) };
      createPurchasePayment({ body: { warehouseId: String(warehouse._id), purchaseOrderId: String(invoice._id), amountPaid: 10, paymentAccount: String(new mongoose.Types.ObjectId()), vendorPaymentAccount: account }, user: { id: manager._id } }, res, err => resolve({ ok: false, err }));
    });
  const foreign = await pay(String(other.paymentAccounts[0]._id));
  assert.equal(foreign.ok, false);
  assert.equal(foreign.err.statusCode, 400);
  assert.match(foreign.err.message, /does not belong to this vendor/);
  const inactive = await pay(String(vendor.paymentAccounts[1]._id));
  assert.match(inactive.err.message, /inactive/);
  assert.equal(await Payment.countDocuments({}), 0, 'nothing recorded');
});
