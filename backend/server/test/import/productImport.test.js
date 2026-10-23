const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const os = require('os');
const path = require('path');
const fs = require('fs').promises;

// Product/Service CSV Import (docs section "Product CSV Import") - replaces the previous
// `importProductAndVariant` controller/validator, which predated the Product/Service split and
// had no `type` column. Reuses the shared flat runner (csvImportRunner.js) exactly like the
// Customer/Vendor importers - one CSV row is one Product document.
//
// Catalog hierarchy is Category -> Brand -> Model/Item Number/Specifications (brand replaced the
// legacy subcategory as the required identification field - see productModel.js#brand).

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_product_import';

let Product, Category, Brand, Warehouse, ChartOfAccount, JournalEntry;
let previewImport, commitImport;
let productSchema;

let category, brand, warehouse, pucAccount, cashAccount;

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  Product = require('../../models/inventory/productModel');
  Category = require('../../models/categoryModel');
  Brand = require('../../models/brandModel');
  Warehouse = require('../../models/inventory/warehouseModel');
  ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
  JournalEntry = require('../../models/accounting/journalEntryModel');
  ({ previewImport, commitImport } = require('../../services/csvImport/csvImportRunner'));
  productSchema = require('../../utils/validators/import/productImportSchema');
  await Promise.all([Product.init(), Category.init(), Brand.init(), Warehouse.init(), ChartOfAccount.init()]);
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  await Promise.all([
    Product.deleteMany({}),
    Category.deleteMany({}),
    Brand.deleteMany({}),
    Warehouse.deleteMany({}),
    ChartOfAccount.deleteMany({}),
    JournalEntry.deleteMany({}),
  ]);

  category = await Category.create({ name: { en: 'Electrical Materials', ar: 'مواد كهربائية' } });
  brand = await Brand.create({ name: { en: 'ACME', ar: 'أكمي' } });
  warehouse = await Warehouse.create({ name: 'Main Warehouse', location: 'Cairo' });
  // Eligible PUC account - active asset, not Cash & Cash Equivalents (isPucAccountEligible).
  pucAccount = await ChartOfAccount.create({ code: '11000009', name: 'PUC - Raw Materials', type: 'asset', isActive: true });
  // Ineligible - a cash account (isPaymentAccountEligible true -> isPucAccountEligible false).
  cashAccount = await ChartOfAccount.create({ code: '10000001', name: 'Cash on Hand', type: 'asset', state: 'cash', isActive: true });
});

async function writeTempCsv(content) {
  const file = path.join(os.tmpdir(), `product-import-test-${Date.now()}-${Math.random().toString(36).slice(2)}.csv`);
  await fs.writeFile(file, Buffer.from(content, 'utf8'));
  return { path: file };
}

const HEADER = 'TitleEn,TitleAr,DescriptionEn,DescriptionAr,Type,Price,PriceAfterDiscount,Cost,CategoryName,BrandName,Model,Specifications,SKU,Barcode,WarehouseName,Quantity,DurationValue,DurationUnit,PucAccountCode,CapacityValue,CapacityUnit,IsAvailable';

function productRow({
  titleEn = 'Copper Cable',
  titleAr = 'كابل نحاس',
  descriptionEn = 'Electrical cable',
  descriptionAr = 'كابل كهربائي',
  type = 'product',
  price = '150',
  priceAfterDiscount = '',
  cost = '90',
  categoryName = 'Electrical Materials',
  brandName = 'ACME',
  model = '',
  specifications = '',
  sku = '',
  barcode = '',
  warehouseName = '',
  quantity = '',
  durationValue = '',
  durationUnit = '',
  pucAccountCode = '',
  capacityValue = '',
  capacityUnit = '',
  isAvailable = '',
} = {}) {
  return [titleEn, titleAr, descriptionEn, descriptionAr, type, price, priceAfterDiscount, cost, categoryName, brandName, model, specifications, sku, barcode, warehouseName, quantity, durationValue, durationUnit, pucAccountCode, capacityValue, capacityUnit, isAvailable].join(',');
}

// ===================== Successful imports =====================

test('1. Successful physical product import: creates a real Product with cost/category/brand/stock', async () => {
  const file = await writeTempCsv(`${HEADER}\n${productRow({ warehouseName: 'Main Warehouse', quantity: '100', sku: 'CAB-001', model: 'PX-200', specifications: 'Stainless steel' })}\n`);
  const { created, failed } = await commitImport(file, productSchema);
  assert.equal(failed.length, 0, JSON.stringify(failed));
  assert.equal(created.length, 1);

  const product = await Product.findById(created[0].id);
  assert.equal(product.type, 'product');
  assert.equal(product.title.en, 'Copper Cable');
  assert.equal(product.cost, 90);
  assert.equal(String(product.category), String(category._id));
  assert.equal(String(product.brand), String(brand._id));
  assert.equal(product.model, 'PX-200');
  assert.equal(product.specifications, 'Stainless steel');
  assert.equal(product.stock.length, 1);
  assert.equal(product.stock[0].quantity, 100);
  assert.ok(product.barcode, 'barcode must be auto-generated when left blank');
});

test('2. Successful service import: creates a Product with type=service, durationValue/pucAccount, no cost/category/stock', async () => {
  const file = await writeTempCsv(
    `${HEADER}\n${productRow({
      titleEn: 'Electrical Installation',
      titleAr: 'تركيب كهربائي',
      type: 'service',
      price: '500',
      cost: '',
      categoryName: '',
      brandName: '',
      durationValue: '1',
      durationUnit: 'month',
      pucAccountCode: '11000009',
    })}\n`,
  );
  const { created, failed } = await commitImport(file, productSchema);
  assert.equal(failed.length, 0, JSON.stringify(failed));

  const service = await Product.findById(created[0].id);
  assert.equal(service.type, 'service');
  assert.equal(service.cost, undefined);
  assert.equal(service.durationValue, 1);
  assert.equal(service.durationUnit, 'month');
  assert.equal(String(service.pucAccount._id), String(pucAccount._id));
  assert.equal(service.stock.length, 0);
});

// ===================== Validation =====================

test('3. Missing required fields (blank TitleEn) are rejected', async () => {
  const file = await writeTempCsv(`${HEADER}\n${productRow({ titleEn: '' })}\n`);
  const { created, failed } = await commitImport(file, productSchema);
  assert.equal(created.length, 0);
  assert.equal(failed.length, 1);
  assert.ok(failed[0].errors.some(e => e.column === 'TitleEn'));
});

test('4. Unsupported product type is rejected', async () => {
  const file = await writeTempCsv(`${HEADER}\n${productRow({ type: 'gadget' })}\n`);
  const { created, failed } = await commitImport(file, productSchema);
  assert.equal(created.length, 0);
  assert.equal(failed.length, 1);
  assert.ok(failed[0].errors.some(e => e.column === 'Type'));
});

test('5. Invalid numeric values (non-numeric Price) are rejected', async () => {
  const file = await writeTempCsv(`${HEADER}\n${productRow({ price: 'not-a-number' })}\n`);
  const { created, failed } = await commitImport(file, productSchema);
  assert.equal(created.length, 0);
  assert.ok(failed[0].errors.some(e => e.column === 'Price'));
});

test('6. Invalid Boolean values (bad IsAvailable) are rejected', async () => {
  const file = await writeTempCsv(`${HEADER}\n${productRow({ isAvailable: 'maybe' })}\n`);
  const { created, failed } = await commitImport(file, productSchema);
  assert.equal(created.length, 0);
  assert.ok(failed[0].errors.some(e => e.column === 'IsAvailable'));
});

test('7. Duplicate TitleEn within the uploaded file: the second occurrence is flagged, not the first', async () => {
  const file = await writeTempCsv(`${HEADER}\n${productRow({ titleAr: 'كابل نحاس 1' })}\n${productRow({ titleAr: 'كابل نحاس 2' })}\n`);
  const { created, failed } = await commitImport(file, productSchema);
  assert.equal(created.length, 1);
  assert.equal(failed.length, 1);
});

test('8. Duplicate TitleEn/TitleAr against an EXISTING product is rejected at preview time, read-only', async () => {
  await Product.create({ type: 'product', title: { en: 'Copper Cable', ar: 'كابل نحاس موجود' }, description: { en: 'd', ar: 'د' }, price: 100, cost: 50, category: category._id, brand: brand._id });
  const countBefore = await Product.countDocuments({});

  const file = await writeTempCsv(`${HEADER}\n${productRow()}\n`);
  const result = await previewImport(file, productSchema);
  assert.equal(result.invalidCount, 1);
  assert.ok(result.errors[0].errors.some(e => e.column === 'TitleEn' && /already exists/i.test(e.message)));
  assert.equal(await Product.countDocuments({}), countBefore, 'preview must never write anything');
});

test('9. Missing required CSV header is rejected', async () => {
  const badHeader = HEADER.replace('Type,', '');
  const file = await writeTempCsv(`${badHeader}\nCopper Cable,كابل نحاس,d,د,product,90,Electrical Materials,ACME,,,,,,,,,,,,\n`);
  await assert.rejects(() => previewImport(file, productSchema), /missing required column.*Type/i);
});

test('10. An empty CSV file (header only, no data rows) is rejected', async () => {
  const file = await writeTempCsv(`${HEADER}\n`);
  await assert.rejects(() => previewImport(file, productSchema), /no data rows/i);
});

test('11. Optional fields (SKU/Barcode/Capacity) are persisted correctly', async () => {
  const file = await writeTempCsv(`${HEADER}\n${productRow({ sku: 'CAB-SKU-1', barcode: '123456789012', capacityValue: '100', capacityUnit: 'kW' })}\n`);
  const { created, failed } = await commitImport(file, productSchema);
  assert.equal(failed.length, 0, JSON.stringify(failed));
  const product = await Product.findById(created[0].id);
  assert.equal(product.sku, 'CAB-SKU-1');
  assert.equal(product.barcode, '123456789012');
  assert.equal(product.capacity.value, 100);
  assert.equal(product.capacity.unit, 'kW');
});

test('12a. A service cannot be given inventory stock via the CSV - WarehouseName/Quantity on a service row is rejected', async () => {
  const file = await writeTempCsv(
    `${HEADER}\n${productRow({ titleEn: 'Bad Service', titleAr: 'خدمة خاطئة', type: 'service', cost: '', categoryName: '', brandName: '', durationValue: '1', durationUnit: 'month', pucAccountCode: '11000009', warehouseName: 'Main Warehouse', quantity: '10' })}\n`,
  );
  const { created, failed } = await commitImport(file, productSchema);
  assert.equal(created.length, 0);
  assert.ok(failed[0].errors.some(e => /cannot have inventory stock/i.test(e.message)));
});

test('12b. A service imported without stock columns ends up with zero stock entries (no inventory initialization)', async () => {
  const file = await writeTempCsv(
    `${HEADER}\n${productRow({ titleEn: 'Clean Service', titleAr: 'خدمة نظيفة', type: 'service', cost: '', categoryName: '', brandName: '', durationValue: '1', durationUnit: 'month', pucAccountCode: '11000009' })}\n`,
  );
  const { created, failed } = await commitImport(file, productSchema);
  assert.equal(failed.length, 0, JSON.stringify(failed));
  const service = await Product.findById(created[0].id);
  assert.equal(service.stock.length, 0);
});

test('13. Importing products/services creates no journal entries or other accounting side effects', async () => {
  const before = await JournalEntry.countDocuments({});
  const file = await writeTempCsv(
    `${HEADER}\n${productRow({ warehouseName: 'Main Warehouse', quantity: '10' })}\n` +
      `${productRow({ titleEn: 'A Service', titleAr: 'خدمة', type: 'service', cost: '', categoryName: '', brandName: '', durationValue: '2', durationUnit: 'month', pucAccountCode: '11000009' })}\n`,
  );
  const { created, failed } = await commitImport(file, productSchema);
  assert.equal(failed.length, 0, JSON.stringify(failed));
  assert.equal(created.length, 2);
  assert.equal(await JournalEntry.countDocuments({}), before, 'importing a product/service must never post accounting entries');
});

test('14. Preview followed by commit using a FRESH upload (stateless preview -> commit, no shared server-side state)', async () => {
  const previewFile = await writeTempCsv(`${HEADER}\n${productRow({ titleEn: 'Stateless Item', titleAr: 'عنصر' })}\n`);
  const previewResult = await previewImport(previewFile, productSchema);
  assert.equal(previewResult.validCount, 1);
  assert.equal(await Product.countDocuments({}), 0);

  // A second, independently-written file with the identical content - the commit never depends on
  // the preview file still existing on disk.
  const commitFile = await writeTempCsv(`${HEADER}\n${productRow({ titleEn: 'Stateless Item', titleAr: 'عنصر' })}\n`);
  const { created, failed } = await commitImport(commitFile, productSchema);
  assert.equal(failed.length, 0, JSON.stringify(failed));
  assert.equal(created.length, 1);
});

test('15a. Duplicate Barcode within the uploaded file is rejected on the second occurrence', async () => {
  const file = await writeTempCsv(
    `${HEADER}\n${productRow({ titleEn: 'Item A', titleAr: 'عنصر أ', barcode: '111111111111' })}\n${productRow({ titleEn: 'Item B', titleAr: 'عنصر ب', barcode: '111111111111' })}\n`,
  );
  const { created, failed } = await commitImport(file, productSchema);
  assert.equal(created.length, 1);
  assert.equal(failed.length, 1);
  assert.ok(failed[0].errors.some(e => e.column === 'Barcode' && /duplicate/i.test(e.message)));
});

test('15b. Duplicate Barcode against an EXISTING product is rejected', async () => {
  await Product.create({ type: 'product', title: { en: 'Existing Item', ar: 'عنصر موجود' }, description: { en: 'd', ar: 'د' }, price: 100, cost: 50, category: category._id, brand: brand._id, barcode: '222222222222' });
  const file = await writeTempCsv(`${HEADER}\n${productRow({ barcode: '222222222222' })}\n`);
  const { created, failed } = await commitImport(file, productSchema);
  assert.equal(created.length, 0);
  assert.ok(failed[0].errors.some(e => e.column === 'Barcode' && /already exists/i.test(e.message)));
});

test('16. An ineligible PUC account (a Cash account) is rejected for a service', async () => {
  const file = await writeTempCsv(
    `${HEADER}\n${productRow({ type: 'service', cost: '', categoryName: '', brandName: '', durationValue: '1', durationUnit: 'month', pucAccountCode: '10000001' })}\n`,
  );
  const { created, failed } = await commitImport(file, productSchema);
  assert.equal(created.length, 0);
  assert.ok(failed[0].errors.some(e => e.column === 'PucAccountCode' && /not eligible/i.test(e.message)));
});

test('17. A PucAccountCode that does not exist is rejected', async () => {
  const file = await writeTempCsv(
    `${HEADER}\n${productRow({ type: 'service', cost: '', categoryName: '', brandName: '', durationValue: '1', durationUnit: 'month', pucAccountCode: '99999999' })}\n`,
  );
  const { created, failed } = await commitImport(file, productSchema);
  assert.equal(created.length, 0);
  assert.ok(failed[0].errors.some(e => e.column === 'PucAccountCode' && /no chart of accounts entry/i.test(e.message)));
});

test('18a. An unknown CategoryName is rejected for a product', async () => {
  const file = await writeTempCsv(`${HEADER}\n${productRow({ categoryName: 'Does Not Exist' })}\n`);
  const { created, failed } = await commitImport(file, productSchema);
  assert.equal(created.length, 0);
  assert.ok(failed[0].errors.some(e => e.column === 'CategoryName'));
});

test('18b. An unknown BrandName is rejected for a product', async () => {
  const file = await writeTempCsv(`${HEADER}\n${productRow({ brandName: 'Does Not Exist Brand' })}\n`);
  const { created, failed } = await commitImport(file, productSchema);
  assert.equal(created.length, 0);
  assert.ok(failed[0].errors.some(e => e.column === 'BrandName'));
});

test('18c. An unknown WarehouseName is rejected', async () => {
  const file = await writeTempCsv(`${HEADER}\n${productRow({ warehouseName: 'Nonexistent Warehouse', quantity: '5' })}\n`);
  const { created, failed } = await commitImport(file, productSchema);
  assert.equal(created.length, 0);
  assert.ok(failed[0].errors.some(e => e.column === 'WarehouseName'));
});

test('18d. A blank BrandName is rejected for a product (required, same as CategoryName)', async () => {
  const file = await writeTempCsv(`${HEADER}\n${productRow({ brandName: '' })}\n`);
  const { created, failed } = await commitImport(file, productSchema);
  assert.equal(created.length, 0);
  assert.ok(failed[0].errors.some(e => e.column === 'BrandName' && /required/i.test(e.message)));
});

// ===================== Sample template =====================

test('19. Sample template: headers and example rows stay aligned (one product, one service)', async () => {
  assert.equal(productSchema.headers.length > 0, true);
  for (const row of productSchema.exampleRows) {
    assert.equal(row.length, productSchema.headers.length);
  }
  const typeIndex = productSchema.headers.indexOf('Type');
  const types = productSchema.exampleRows.map(r => r[typeIndex]);
  assert.ok(types.includes('product'), 'template must include a physical product example');
  assert.ok(types.includes('service'), 'template must include a service example');
});
