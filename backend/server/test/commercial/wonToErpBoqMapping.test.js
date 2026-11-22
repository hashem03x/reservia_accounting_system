const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// System-wide fix program (Phase 1, item 3): buildErpBoqLines() used to match a BOQ line to a
// catalog Product by case-insensitive substring alone - with a one-product catalog in production
// that produced an empty boqLines array, and in general could silently confuse "4mm"/"6mm"/"10mm"
// cable variants that share every word except the size. This test exercises the real function
// against a real (local) database: the new materialItemKey -> MaterialItem.erpProduct exact link,
// the safer substring fallback's numeric-size conflict guard, ambiguous-match detection, and the
// unmatched-line report - not just a read-through of the code.
//
// Self-skips without TEST_DB_URI, like every other DB-backed suite in this repo.
const DB_URI = process.env.TEST_DB_URI;
const RUN = !!DB_URI;
const maybeTest = RUN ? test : test.skip;

let Product, MaterialItem, buildErpBoqLines;

before(async () => {
  if (!RUN) return;
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  Product = require('../../models/inventory/productModel');
  MaterialItem = require('../../models/commercial/materialItemModel');
  ({ buildErpBoqLines } = require('../../services/crm/wonToErpService'));

  const Category = require('../../models/categoryModel');
  const category = await Category.create({ name: { en: 'Electrical', ar: 'كهرباء' } });

  await Product.create([
    { title: { en: 'DC Solar Cable 4mm2', ar: 'كابل 4مم' }, description: { en: '-', ar: '-' }, type: 'product', category: category._id },
    { title: { en: 'DC Solar Cable 6mm2', ar: 'كابل 6مم' }, description: { en: '-', ar: '-' }, type: 'product', category: category._id },
    { title: { en: 'Mounting Structure', ar: 'هيكل تثبيت' }, description: { en: '-', ar: '-' }, type: 'product', category: category._id },
    { title: { en: 'Hangar Roof Mounting Structure', ar: 'هيكل سقف' }, description: { en: '-', ar: '-' }, type: 'product', category: category._id },
    { title: { en: 'JKM475M-7RL3 PV Module', ar: 'لوح شمسي' }, description: { en: '-', ar: '-' }, type: 'product', category: category._id },
    // Deliberately colliding under plain substring containment ("Breaker X4" is a literal prefix
    // of "Breaker X40 Type") despite naming two different, unrelated ratings - demonstrates why
    // hasConflictingSize is needed, not just the "4mm2 vs 6mm2" case where a unit suffix already
    // happens to break plain substring containment on its own.
    { title: { en: 'Breaker X4', ar: 'قاطع X4' }, description: { en: '-', ar: '-' }, type: 'product', category: category._id },
    { title: { en: 'Breaker X40 Type', ar: 'قاطع X40' }, description: { en: '-', ar: '-' }, type: 'product', category: category._id },
  ]);
  const linkedProduct = await Product.findOne({ 'title.en': 'JKM475M-7RL3 PV Module' });

  await MaterialItem.create([
    {
      category: 'PV Modules', brand: 'Jinko', model: 'JKM475M-7RL3', spec: '475W', unit: 'pcs', unitPrice: 5000, currency: 'EGP',
      sourceWorkbook: 'test', sourceSheet: 'test', key: 'Jinko | JKM475M-7RL3 | 475W', erpProduct: linkedProduct._id,
    },
    {
      category: 'DC Cable', brand: 'Generic', model: 'DC-4', spec: '4mm2', unit: 'm', unitPrice: 20, currency: 'EGP',
      sourceWorkbook: 'test', sourceSheet: 'test', key: 'Generic | DC-4 | 4mm2', // no erpProduct link - exercises the fallback path
    },
  ]);
});

after(async () => {
  if (!RUN) return;
  await mongoose.disconnect();
});

maybeTest('exact match via a Price Book item linked to a real ERP product (materialItemKey)', async () => {
  const linkedProduct = await Product.findOne({ 'title.en': 'JKM475M-7RL3 PV Module' });
  const { lines, warnings } = await buildErpBoqLines([
    { component: 'PV Modules', description: 'JKM475M-7RL3', materialItemKey: 'Jinko | JKM475M-7RL3 | 475W', qty: 100, unitPrice: 5000, total: 500000, unit: 'pcs' },
  ]);
  assert.equal(warnings.length, 0);
  assert.equal(lines.length, 1);
  assert.equal(String(lines[0].product), String(linkedProduct._id));
  assert.equal(lines[0].quantity, 100);
});

maybeTest('safe substring fallback still matches an unlinked Price Book line by description', async () => {
  const cable4mm = await Product.findOne({ 'title.en': 'DC Solar Cable 4mm2' });
  const { lines, warnings } = await buildErpBoqLines([
    { component: 'DC Cable', description: 'DC Solar Cable 4mm2', materialItemKey: 'Generic | DC-4 | 4mm2', qty: 50, unitPrice: 20, total: 1000, unit: 'm' },
  ]);
  assert.equal(warnings.length, 0);
  assert.equal(lines.length, 1);
  assert.equal(String(lines[0].product), String(cable4mm._id));
});

maybeTest('REGRESSION GUARD: a plain substring that only coincidentally matches a different rating is rejected, not silently picked', async () => {
  // "Breaker X4" IS a literal substring of this description - the exact false positive the old,
  // pure-substring matcher would have accepted. hasConflictingSize must reject it (4 != 40).
  const { lines, warnings } = await buildErpBoqLines([
    { component: 'AC Circuit Breaker', description: 'Breaker X40 Type for the DB panel', qty: 2, unitPrice: 500, total: 1000, unit: 'pcs' },
  ]);
  const x40 = await Product.findOne({ 'title.en': 'Breaker X40 Type' });
  if (lines.length) {
    // Matching its own exact title is fine; matching the unrelated X4 rating is the bug this guards.
    assert.equal(String(lines[0].product), String(x40._id));
  } else {
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /no matching product/);
  }
});

maybeTest('ambiguous match (two equally-plausible candidates) is reported, never guessed', async () => {
  const { lines, warnings } = await buildErpBoqLines([
    { component: 'Mounting Structure', description: 'Mounting Structure', qty: 1, unitPrice: 10000, total: 10000, unit: 'kWp' },
  ]);
  assert.equal(lines.length, 0);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /ambiguously/);
});

maybeTest('a line with no matching product anywhere is reported as unmatched, not fabricated', async () => {
  const { lines, warnings } = await buildErpBoqLines([
    { component: 'AC Circuit Breaker', description: '63A 3-Phase MCCB', qty: 1, unitPrice: 3000, total: 3000, unit: 'pcs' },
  ]);
  assert.equal(lines.length, 0);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /no matching product/);
});

maybeTest('an unpriced/zero-qty line is skipped entirely (no warning, no line)', async () => {
  const { lines, warnings } = await buildErpBoqLines([
    { component: 'PV Modules', description: 'JKM475M-7RL3', materialItemKey: 'Jinko | JKM475M-7RL3 | 475W', qty: 0, unitPrice: 5000, total: 0, unit: 'pcs' },
  ]);
  assert.equal(lines.length, 0);
  assert.equal(warnings.length, 0);
});
