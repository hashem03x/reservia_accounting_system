const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Fixed Assets module (services/fixedAssets/*): Chart of Accounts group rules, the acquisition
// entry (Dr asset + input VAT / Cr Suppliers - vendor), and the manual monthly depreciation run
// (Dr Depreciation & Amortization / Cr Accumulated), including duplicate months, the zero floor,
// several assets in one run and a full rollback.

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_fixed_assets';

const { AutomaticJournalAccountCodes: C } = require('../../utils/accountingConstants');

let FixedAsset, ChartOfAccount, JournalEntry, Vendor, Warehouse, Payment;
let createFixedAsset, updateFixedAsset, runDepreciation, getFixedAssetAccountOptions;
let transactionsSupported = true;
let vendor, accounts;

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
  ({ createFixedAsset, updateFixedAsset, runDepreciation } = require('../../services/fixedAssets/fixedAssetService'));
  ({ getFixedAssetAccountOptions } = require('../../services/fixedAssets/fixedAssetAccounts'));
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

// Chart of Accounts shaped like the imported one: groups are parentGroupNameEn values.
const CHART = {
  vehicles: { code: '12000001', name: 'Vehicles', type: 'asset', parentGroupNameEn: 'Property, Plant & Equipment' },
  accDep: { code: '12000099', name: 'Accumulated Depreciation – Fixed Assets', type: 'asset', parentGroupNameEn: 'Property, Plant & Equipment' },
  software: { code: '13000001', name: 'Software Licenses', type: 'asset', parentGroupNameEn: 'Intangible Assets' },
  accAmort: { code: '13000099', name: 'Accumulated Amortization - Intangible Assets', type: 'asset', parentGroupNameEn: 'Intangible Assets' },
  depExpense: { code: '62000001', name: 'Depreciation & Amortization', type: 'expense', parentGroupNameEn: 'Operating Expenses' },
  cash: { code: '11000001', name: 'Bank Misr', type: 'asset', parentGroupNameEn: 'Cash & Cash Equivalents' },
  suppliers: { code: C.suppliers, name: 'Suppliers', type: 'liability' },
  inputVat: { code: C.inputVat, name: 'Input VAT', type: 'asset' },
};

beforeEach(async () => {
  await Promise.all([FixedAsset, ChartOfAccount, JournalEntry, Vendor, Warehouse, Payment].map(M => M.deleteMany({})));
  accounts = {};
  for (const [key, data] of Object.entries(CHART)) accounts[key] = await ChartOfAccount.create(data);
  vendor = await Vendor.create({ name: 'Auto Dealer', contact: { phone: `010${Date.now()}`.slice(0, 11) } });
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
  price: 120000,
  usefulLifeMonths: 60,
  vatPercentage: 14,
  notes: 'Fleet',
  ...overrides,
});
const SOFTWARE = (overrides = {}) =>
  VEHICLE({ name: 'ERP License', assetAccountId: accounts.software._id, accumulatedAccountId: accounts.accAmort._id, price: 36000, usefulLifeMonths: 36, vatPercentage: 0, ...overrides });
const create = data => inTx(session => createFixedAsset(data, null, session));
const depreciate = period => inTx(session => runDepreciation({ period, userId: null }, session));
const linesOf = entry => entry.lines.map(l => [codeOf(l.account), l.debit, l.credit]);

test('account options come from the Chart of Accounts groups, never other accounts', async () => {
  const options = await getFixedAssetAccountOptions();
  assert.deepEqual(
    options.assetAccounts.map(a => [a.name, a.assetClass]),
    [
      ['Vehicles', 'tangible'],
      ['Software Licenses', 'intangible'],
    ],
    'PP&E and Intangible accounts only - not the accumulated contra accounts, not cash'
  );
  assert.deepEqual(options.accumulatedDepreciationAccounts.map(a => a.name), ['Accumulated Depreciation – Fixed Assets']);
  assert.deepEqual(options.accumulatedAmortizationAccounts.map(a => a.name), ['Accumulated Amortization - Intangible Assets']);
  assert.deepEqual(options.depreciationExpenseAccounts.map(a => a.name), ['Depreciation & Amortization']);
});

test('tangible asset: acquisition entry Dr asset + input VAT / Cr Suppliers with the Vendor Number on every line; no inventory or payment', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  const asset = await create(VEHICLE());
  const stored = await FixedAsset.findById(asset._id).lean();
  assert.equal(stored.assetClass, 'tangible');
  assert.equal(stored.price, 120000);
  assert.equal(stored.bookValue, 120000, 'initial Book Value = cost');
  assert.equal(stored.accumulatedDepreciation, 0);
  assert.equal(stored.vatAmount, 16800);
  assert.equal(stored.totalAmount, 136800);
  assert.equal(stored.usefulLifeMonths, 60);
  assert.equal('fairValue' in stored, false, 'no fair value is stored');

  const entry = await JournalEntry.findById(stored.acquisitionJournalEntry).lean();
  assert.equal(entry.accountingAction, 'FIXED_ASSET_ACQUISITION');
  assert.equal(entry.module, 'Fixed Asset');
  assert.deepEqual(linesOf(entry), [
    ['vehicles', 120000, 0],
    ['inputVat', 16800, 0],
    ['suppliers', 0, 136800],
  ]);
  assert.equal(entry.totalDebit, entry.totalCredit);
  for (const line of entry.lines) {
    assert.equal(line.partyNumber, vendor.vendorNumber, 'Sub Account = Vendor Number');
    assert.equal(line.partyType, 'vendor');
    assert.ok(line.description);
    assert.equal(line.description, entry.description);
    assert.equal(line.projectNumber, null, 'no project number on a fixed asset entry');
  }
  assert.equal((await Vendor.findById(vendor._id).lean()).balance, 136800, 'owed to the vendor');
  assert.equal(await Payment.countDocuments({}), 0, 'no payment and no cash movement at acquisition');
  assert.equal(await mongoose.connection.collection('movements').countDocuments({}), 0, 'no inventory movement');
});

test('intangible asset is recorded on its Intangible Assets account and amortized', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  const asset = await create(SOFTWARE());
  assert.equal(asset.assetClass, 'intangible');
  const result = await depreciate('2026-01');
  assert.equal(result.processed.length, 1);
  const entry = await JournalEntry.findById(result.processed[0].journalEntry).lean();
  assert.equal(entry.description, 'Amortization - ERP License - 2026-01');
  assert.deepEqual(linesOf(entry), [
    ['depExpense', 1000, 0],
    ['accAmort', 0, 1000],
  ]);
});

test('invalid accounts are rejected and nothing is created', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  await assert.rejects(() => create(VEHICLE({ assetAccountId: accounts.cash._id })), /asset account must be an active account under "Property, Plant & Equipment" or "Intangible Assets"/);
  await assert.rejects(() => create(VEHICLE({ assetAccountId: accounts.accDep._id })), /asset account must be/);
  await assert.rejects(() => create(VEHICLE({ accumulatedAccountId: accounts.accAmort._id })), /Accumulated Depreciation – Fixed Assets/, 'a tangible asset needs accumulated DEPRECIATION');
  await assert.rejects(() => create(SOFTWARE({ accumulatedAccountId: accounts.accDep._id })), /Accumulated Amortization – Intangible Assets/);
  await assert.rejects(() => create(VEHICLE({ depreciationAccountId: accounts.cash._id })), /Depreciation & Amortization/);
  await ChartOfAccount.updateOne({ _id: accounts.vehicles._id }, { $set: { isActive: false } });
  await assert.rejects(() => create(VEHICLE()), /asset account must be an active account/);
  assert.equal(await FixedAsset.countDocuments({}), 0);
  assert.equal(await JournalEntry.countDocuments({}), 0);
  assert.equal((await Vendor.findById(vendor._id).lean()).balance, 0);
});

test('monthly depreciation: cost / life, Dr Depreciation & Amortization / Cr Accumulated, never twice for the same month', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  const asset = await create(VEHICLE());
  const first = await depreciate('2026-01');
  assert.equal(first.processed.length, 1);
  assert.equal(first.processed[0].amount, 2000, '120,000 / 60');

  const entry = await JournalEntry.findById(first.processed[0].journalEntry).lean();
  assert.equal(entry.accountingAction, 'FIXED_ASSET_DEPRECIATION');
  assert.equal(entry.description, 'Depreciation - Delivery Truck - 2026-01');
  assert.deepEqual(linesOf(entry), [
    ['depExpense', 2000, 0],
    ['accDep', 0, 2000],
  ]);
  for (const line of entry.lines) {
    assert.equal(line.description, entry.description);
    assert.equal(line.partyNumber, null, 'the vendor is not the Sub Account of depreciation');
  }
  assert.equal(new Date(entry.date).toISOString().slice(0, 10), '2026-01-31', 'dated the last day of the month');

  let stored = await FixedAsset.findById(asset._id).lean();
  assert.equal(stored.accumulatedDepreciation, 2000);
  assert.equal(stored.bookValue, 118000);
  assert.deepEqual(stored.depreciations.map(d => [d.period, d.amount]), [['2026-01', 2000]]);

  // The same month again: nothing new.
  const again = await depreciate('2026-01');
  assert.equal(again.processed.length, 0);
  assert.equal(await JournalEntry.countDocuments({ accountingAction: 'FIXED_ASSET_DEPRECIATION' }), 1);

  // Ten months in total -> accumulated 20,000, Book Value 100,000.
  for (const month of ['02', '03', '04', '05', '06', '07', '08', '09', '10']) await depreciate(`2026-${month}`);
  stored = await FixedAsset.findById(asset._id).lean();
  assert.equal(stored.accumulatedDepreciation, 20000);
  assert.equal(stored.bookValue, 100000);
  assert.equal(stored.depreciations.length, 10);
  assert.equal(stored.status, 'active');
});

test('depreciation stops at a Book Value of zero (the last month takes the rounding remainder)', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  const asset = await create(VEHICLE({ price: 1000, usefulLifeMonths: 3, vatPercentage: 0 }));
  const amounts = [];
  for (const period of ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05']) {
    const result = await depreciate(period);
    amounts.push(result.processed.map(p => p.amount)[0] ?? null);
  }
  assert.deepEqual(amounts, [333.33, 333.33, 333.34, null, null]);
  const stored = await FixedAsset.findById(asset._id).lean();
  assert.equal(stored.bookValue, 0);
  assert.equal(stored.accumulatedDepreciation, 1000);
  assert.equal(stored.status, 'fully_depreciated');
  assert.equal(await JournalEntry.countDocuments({ accountingAction: 'FIXED_ASSET_DEPRECIATION' }), 3);
});

test('a run processes every eligible asset; an asset is only depreciated from its Asset Date month', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  await create(VEHICLE());
  await create(SOFTWARE());
  await create(VEHICLE({ name: 'Forklift', acquisitionDate: new Date('2026-05-10') }));
  const april = await depreciate('2026-04');
  assert.deepEqual(april.processed.map(p => [p.name, p.amount]).sort(), [
    ['Delivery Truck', 2000],
    ['ERP License', 1000],
  ]);
  assert.equal(april.totalAmount, 3000);
  const may = await depreciate('2026-05');
  assert.equal(may.processed.length, 3);
});

test('if any asset fails, the whole depreciation run is rolled back', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  const truck = await create(VEHICLE());
  const license = await create(SOFTWARE());
  const originalCreate = JournalEntry.create;
  let depreciationEntries = 0;
  JournalEntry.create = function (docs, ...rest) {
    if (Array.isArray(docs) && docs[0]?.accountingAction === 'FIXED_ASSET_DEPRECIATION' && ++depreciationEntries === 2) throw new Error('forced depreciation failure');
    return originalCreate.call(this, docs, ...rest);
  };
  try {
    await assert.rejects(() => depreciate('2026-01'), /forced depreciation failure/);
  } finally {
    JournalEntry.create = originalCreate;
  }
  assert.equal(await JournalEntry.countDocuments({ accountingAction: 'FIXED_ASSET_DEPRECIATION' }), 0, 'no depreciation entry survives');
  for (const asset of [truck, license]) {
    const stored = await FixedAsset.findById(asset._id).lean();
    assert.equal(stored.accumulatedDepreciation, 0);
    assert.equal(stored.bookValue, stored.price);
    assert.equal(stored.depreciations.length, 0);
  }
});

test('if the acquisition entry fails, the asset is not created', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  await ChartOfAccount.deleteOne({ code: C.suppliers });
  await assert.rejects(() => create(VEHICLE()), /required Chart of Accounts account "31000001" was not found/);
  assert.equal(await FixedAsset.countDocuments({}), 0);
  assert.equal(await JournalEntry.countDocuments({}), 0);
  assert.equal((await Vendor.findById(vendor._id).lean()).balance, 0);
});

test('a future or malformed month is refused', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  await create(VEHICLE());
  await assert.rejects(() => depreciate('2099-01'), /future month/);
  await assert.rejects(() => depreciate('2026-13'), /YYYY-MM/);
  assert.equal(await JournalEntry.countDocuments({ accountingAction: 'FIXED_ASSET_DEPRECIATION' }), 0);
});

test('editing changes only name/notes/status; a disposed asset is no longer depreciated', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  const asset = await create(VEHICLE());
  await inTx(session => updateFixedAsset(asset._id, { name: 'Truck 1', notes: 'Renamed', status: 'disposed', price: 1 }, session));
  const stored = await FixedAsset.findById(asset._id).lean();
  assert.equal(stored.name, 'Truck 1');
  assert.equal(stored.status, 'disposed');
  assert.equal(stored.price, 120000, 'cost is not editable');
  await assert.rejects(() => inTx(session => updateFixedAsset(asset._id, { status: 'fully_depreciated' }, session)), /cannot be set manually/);
  assert.equal((await depreciate('2026-01')).processed.length, 0);
});

test('an asset created before the Fixed Assets module still loads; a fair value is never stored', async () => {
  const warehouse = await Warehouse.create({ name: 'Main', location: 'Cairo' });
  const legacy = await FixedAsset.create({ name: 'Old asset', bookValue: 1000, warehouseId: warehouse._id, fairValue: 900 });
  const raw = await FixedAsset.collection.findOne({ _id: legacy._id });
  assert.equal('fairValue' in raw, false);
  const loaded = await FixedAsset.findById(legacy._id);
  assert.equal(loaded.bookValue, 1000);
  assert.equal(loaded.toJSON().loseValue, undefined);
});
