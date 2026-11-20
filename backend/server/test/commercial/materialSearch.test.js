const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Deal Engine Rev 01 open item: "Search box on Materials does not filter - every query returns
// the same first 50 rows." materialController.js never used no session/transaction - runs for
// real against a plain standalone MongoDB, its own throwaway database, dropped at the end.

const DB_URI = 'mongodb://127.0.0.1:27017/materials_search_test';

let MaterialItem, materialController;

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  MaterialItem = require('../../models/commercial/materialItemModel');
  materialController = require('../../controller/commercial/materialController');
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

const BASE = { unit: 'pcs', unitPrice: 5000, sourceSheet: 'Manual', sourceWorkbook: 'Manual', priceHistory: [] };

beforeEach(async () => {
  await MaterialItem.deleteMany({});
  await MaterialItem.create([
    { ...BASE, category: 'Modules', brand: 'Jinko', model: 'Tiger Neo 670W', key: 'Jinko | Tiger Neo 670W | ' },
    { ...BASE, category: 'Modules', brand: 'Canadian Solar', model: 'HiKu7', key: 'Canadian Solar | HiKu7 | ' },
    { ...BASE, category: 'Inverters', brand: 'Huawei', model: 'SUN2000-150KTL', key: 'Huawei | SUN2000-150KTL | ' },
  ]);
});

function mockRes() {
  return { status(c) { this._status = c; return this; }, json(b) { this._json = b; return this; } };
}

test('listMaterials: a keyword matching the brand filters down to the matching item(s)', async () => {
  const res = mockRes();
  await materialController.listMaterials({ query: { keyword: 'Jinko' }, filterObject: {} }, res);
  assert.equal(res._json.results, 1);
  assert.equal(res._json.data[0].model, 'Tiger Neo 670W');
});

test('listMaterials: a keyword matching the model filters correctly, case-insensitively', async () => {
  const res = mockRes();
  await materialController.listMaterials({ query: { keyword: 'sun2000' }, filterObject: {} }, res);
  assert.equal(res._json.results, 1);
  assert.equal(res._json.data[0].brand, 'Huawei');
});

test('listMaterials: a keyword matching nothing returns zero rows, not the unfiltered first page (the actual bug)', async () => {
  const res = mockRes();
  await materialController.listMaterials({ query: { keyword: 'NothingMatchesThis' }, filterObject: {} }, res);
  assert.equal(res._json.results, 0);
});

test('listMaterials: category filter and keyword search combine with AND, not OR', async () => {
  const res = mockRes();
  await materialController.listMaterials({ query: { category: 'Modules', keyword: 'Huawei' }, filterObject: {} }, res);
  assert.equal(res._json.results, 0, 'Huawei is an Inverter, not a Module - must not match');
});

test('listMaterials: no keyword at all still returns every (non-archived) item, unchanged from before this fix', async () => {
  const res = mockRes();
  await materialController.listMaterials({ query: {}, filterObject: {} }, res);
  assert.equal(res._json.results, 3);
});
