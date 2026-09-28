const { test } = require('node:test');
const assert = require('node:assert/strict');
const transformFileDataToProductData = require('../utils/transformFileDataToProductData');

function csvRow(overrides) {
  return {
    'title.en': 'Classic T-Shirt',
    'title.ar': 'تي شيرت كلاسيك',
    'description.en': 'Premium cotton',
    'description.ar': 'قطن ممتاز',
    cost: '50',
    price: '120',
    priceAfterDiscount: '100',
    category: 'c1',
    subcategory: 'sc1',
    season: 'all',
    'color.name': 'white',
    'color.isDefault': 'true',
    sku: '',
    size: 'S',
    quantity: '10',
    warehouse: '',
    ...overrides,
  };
}

test('groups multiple rows with a unique per-row SKU into ONE product with all variants - regression for the reported "variants skipped entirely" bug', () => {
  // Reproduces the real-world shape: same title on every row, a DIFFERENT sku per row (one per
  // variant) - this used to be misread as 12 separate single-variant "products" (grouping by sku
  // instead of title), all but the first of which were silently dropped when they collided on the
  // product schema's unique title index.
  const rows = [
    csvRow({ 'color.name': 'white', sku: 'TS-WHT-S', size: 'S', quantity: '10' }),
    csvRow({ 'color.name': 'white', sku: 'TS-WHT-M', size: 'M', quantity: '15' }),
    csvRow({ 'color.name': 'navy', 'color.isDefault': 'false', sku: 'TS-NVY-S', size: 'S', quantity: '8' }),
    csvRow({ 'color.name': 'navy', 'color.isDefault': 'false', sku: 'TS-NVY-M', size: 'M', quantity: '12' }),
  ];

  const products = transformFileDataToProductData(rows);

  assert.equal(products.length, 1, 'all four rows must become ONE product, not four');
  const product = products[0];
  assert.equal(product.variants.length, 4, 'no variant should be silently dropped');
  assert.deepEqual(
    product.variants.map(v => v.sku).sort(),
    ['TS-NVY-M', 'TS-NVY-S', 'TS-WHT-M', 'TS-WHT-S']
  );
  assert.equal(product.colors.length, 2, 'both colors must be present (not just the first row\'s)');
});

test('collects barcode per variant when the CSV supplies one', () => {
  const rows = [csvRow({ sku: 'TS-WHT-S', barcode: '1234567890123' })];
  const products = transformFileDataToProductData(rows);
  assert.equal(products[0].variants[0].barcode, '1234567890123');
});

test('collects and dedupes images per color, preserving order, from a pipe-delimited images column', () => {
  const rows = [
    csvRow({
      'color.name': 'white',
      sku: 'TS-WHT-S',
      images: 'https://cdn.example.com/white-1.jpg|https://cdn.example.com/white-2.jpg',
    }),
    csvRow({
      'color.name': 'white',
      sku: 'TS-WHT-M',
      images: 'https://cdn.example.com/white-2.jpg|https://cdn.example.com/white-3.jpg', // white-2 repeated
    }),
  ];

  const products = transformFileDataToProductData(rows);
  const whiteColor = products[0].colors.find(c => c.name === 'white');
  assert.deepEqual(
    whiteColor.images.map(img => img.url),
    ['https://cdn.example.com/white-1.jpg', 'https://cdn.example.com/white-2.jpg', 'https://cdn.example.com/white-3.jpg']
  );
});

test('keeps the accounting warehouse id from the CSV row on each variant (not silently discarded)', () => {
  const rows = [csvRow({ sku: 'TS-WHT-S', warehouse: '67ab687c6df96bbd4b3f4887' })];
  const products = transformFileDataToProductData(rows);
  assert.equal(products[0].variants[0].warehouse, '67ab687c6df96bbd4b3f4887');
});

test('does not silently drop a row missing color/size - it is simply not turned into a variant, product still created', () => {
  const rows = [csvRow({ 'color.name': '', size: '' })];
  const products = transformFileDataToProductData(rows);
  assert.equal(products.length, 1);
  assert.equal(products[0].variants.length, 0);
});

test('two genuinely different products (different titles) stay separate', () => {
  const rows = [
    csvRow({ 'title.en': 'Classic T-Shirt', sku: 'TS-WHT-S' }),
    csvRow({ 'title.en': 'Denim Jeans', sku: 'DJ-BLU-30', 'color.name': 'blue', size: '30' }),
  ];
  const products = transformFileDataToProductData(rows);
  assert.equal(products.length, 2);
});
