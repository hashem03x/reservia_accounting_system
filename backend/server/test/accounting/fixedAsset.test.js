const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_fixed_assets';

let FixedAsset;
let ChartOfAccount;
let Warehouse;
let warehouse;
let assetAccount;

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  FixedAsset = require('../../models/fixedAssets');
  ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
  Warehouse = require('../../models/inventory/warehouseModel');
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  await FixedAsset.deleteMany({});
  await ChartOfAccount.deleteMany({});
  await Warehouse.deleteMany({});
  warehouse = await Warehouse.create({ name: 'Main Warehouse', location: 'Cairo' });
  assetAccount = await ChartOfAccount.create({ code: '1500', name: 'Fixed Assets', type: 'asset' });
});

test('creates a fixed asset with the pre-existing required fields (backward compatible)', async () => {
  const asset = await FixedAsset.create({ name: 'Old-style asset', bookValue: 1000, fairValue: 1000, warehouseId: warehouse._id });
  assert.equal(asset.name, 'Old-style asset');
  assert.equal(asset.loseValue, 0);
});

test('creates a fixed asset with the new accounting-foundation fields, correctly linked to a Chart of Accounts entry', async () => {
  const asset = await FixedAsset.create({
    name: 'Company laptop',
    bookValue: 2500,
    fairValue: 2500,
    price: 2500,
    warehouseId: warehouse._id,
    assetAccountId: assetAccount._id,
    acquisitionDate: new Date('2026-01-15'),
    status: 'active',
    notes: 'Assigned to finance department',
  });

  const found = await FixedAsset.findById(asset._id);
  assert.equal(found.price, 2500);
  assert.equal(found.assetAccountId.code, '1500');
  assert.equal(found.status, 'active');
});

test('an invalid (non-existent) asset account reference is rejected at the schema/cast level', async () => {
  const bogusId = new mongoose.Types.ObjectId();
  // The document itself will save (a ref is not existence-checked at the model layer - that's
  // what fixedAssetValidators.js's createFixedAssetValidators is for at the HTTP boundary), but
  // populating it must resolve to nothing, proving no real account backs this asset.
  const asset = await FixedAsset.create({ name: 'Orphan-account asset', bookValue: 500, fairValue: 500, warehouseId: warehouse._id, assetAccountId: bogusId });
  const found = await FixedAsset.findById(asset._id);
  assert.equal(found.assetAccountId, null, 'populate must resolve to null for a non-existent account reference');
});

test('updates a fixed asset', async () => {
  const asset = await FixedAsset.create({ name: 'Printer', bookValue: 300, fairValue: 300, warehouseId: warehouse._id });
  const updated = await FixedAsset.findByIdAndUpdate(asset._id, { fairValue: 250 }, { new: true, runValidators: true });
  assert.equal(updated.fairValue, 250);
  assert.equal(updated.loseValue, 50);
});
