const { test } = require('node:test');
const assert = require('node:assert/strict');
const transformFileDataToProductData = require('../utils/transformFileDataToProductData');

function csvRow(overrides) {
  return {
    'title.en': 'Solar Inverter',
    'title.ar': 'عاكس شمسي',
    'description.en': 'Grid-tied inverter',
    'description.ar': 'عاكس متصل بالشبكة',
    cost: '50',
    price: '120',
    priceAfterDiscount: '100',
    category: 'c1',
    subcategory: 'sc1',
    sku: '',
    quantity: '10',
    warehouse: '',
    ...overrides,
  };
}

test('groups multiple rows with a unique per-row SKU into ONE product with all rows - regression for the reported "rows skipped entirely" bug', () => {
  // Reproduces the real-world shape: same title on every row, a DIFFERENT sku per row (one per
  // warehouse batch) - this used to be misread as separate single-row "products" (grouping by sku
  // instead of title), all but the first of which were silently dropped when they collided on the
  // product schema's unique title index.
  const rows = [
    csvRow({ sku: 'INV-001', quantity: '10' }),
    csvRow({ sku: 'INV-002', quantity: '15' }),
  ];

  const products = transformFileDataToProductData(rows);

  assert.equal(products.length, 1, 'both rows must become ONE product, not two');
  const product = products[0];
  assert.equal(product.rows.length, 2, 'no row should be silently dropped');
  assert.deepEqual(
    product.rows.map(r => r.sku).sort(),
    ['INV-001', 'INV-002']
  );
});

test('collects barcode per row when the CSV supplies one', () => {
  const rows = [csvRow({ sku: 'INV-001', barcode: '1234567890123' })];
  const products = transformFileDataToProductData(rows);
  assert.equal(products[0].rows[0].barcode, '1234567890123');
});

test('captures capacity value/unit from the CSV when supplied', () => {
  const rows = [csvRow({ sku: 'INV-001', 'capacity.value': '100', 'capacity.unit': 'kW' })];
  const products = transformFileDataToProductData(rows);
  assert.deepEqual(products[0].capacity, { value: 100, unit: 'kW' });
});

test('leaves capacity unset when the CSV does not supply it', () => {
  const rows = [csvRow({ sku: 'INV-001' })];
  const products = transformFileDataToProductData(rows);
  assert.equal(products[0].capacity, undefined);
});

test('keeps the accounting warehouse id from the CSV row on each row (not silently discarded)', () => {
  const rows = [csvRow({ sku: 'INV-001', warehouse: '67ab687c6df96bbd4b3f4887' })];
  const products = transformFileDataToProductData(rows);
  assert.equal(products[0].rows[0].warehouse, '67ab687c6df96bbd4b3f4887');
});

test('a row with no quantity still becomes a stock row (quantity 0), product still created', () => {
  const rows = [csvRow({ quantity: '' })];
  const products = transformFileDataToProductData(rows);
  assert.equal(products.length, 1);
  assert.equal(products[0].rows.length, 1);
  assert.equal(products[0].rows[0].quantity, 0);
});

test('two genuinely different products (different titles) stay separate', () => {
  const rows = [
    csvRow({ 'title.en': 'Solar Inverter', sku: 'INV-001' }),
    csvRow({ 'title.en': 'Battery Pack', sku: 'BAT-030' }),
  ];
  const products = transformFileDataToProductData(rows);
  assert.equal(products.length, 2);
});
