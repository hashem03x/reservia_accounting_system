const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Product catalog migration (scripts/migrateSubcategoryToBrand.js) - exercised directly via its
// exported function with `connect:false` (reuses this test's own DB connection), the same
// technique test/portal/migration.test.js uses for scripts/backfillErpSystemMemberships.js.

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_migrate_subcategory_to_brand';

let Product, Category, SubCategory, Brand;
let migrateSubcategoryToBrand;

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  Product = require('../../models/inventory/productModel');
  Category = require('../../models/categoryModel');
  SubCategory = require('../../models/subCategoryModel');
  Brand = require('../../models/brandModel');
  ({ migrateSubcategoryToBrand } = require('../../scripts/migrateSubcategoryToBrand'));
  await Product.init();
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  await Product.deleteMany({});
  await Category.deleteMany({});
  await SubCategory.deleteMany({});
  await Brand.deleteMany({});
});

let seq = 0;
// Simulates a pre-existing ("legacy") product saved before `brand` became required on the
// schema - bypasses validation deliberately (validateBeforeSave:false), the same way a document
// already sitting in a production database would never be re-validated against a newly-added
// required field until it's next explicitly re-saved.
async function makeProduct(overrides = {}) {
  seq += 1;
  const product = new Product({
    title: { en: `Product ${seq}`, ar: `منتج ${seq}` },
    description: { en: 'd', ar: 'د' },
    cost: 10,
    price: 20,
    ...overrides,
  });
  await product.save({ validateBeforeSave: false });
  return product;
}

test('backfills brand from an existing product\'s subcategory, finding-or-creating a Brand with the same name', async () => {
  const category = await Category.create({ name: { en: 'Cables', ar: 'كابلات' } });
  const subcategory = await SubCategory.create({ name: { en: 'ACME', ar: 'أكمي' }, mainCategory: category._id });
  const product = await makeProduct({ category: category._id, subcategory: subcategory._id });

  const result = await migrateSubcategoryToBrand({ connect: false });
  assert.equal(result.found, 1);
  assert.equal(result.migrated.length, 1);
  assert.equal(result.migrated[0].created, true);

  const reloaded = await Product.findById(product._id);
  assert.ok(reloaded.brand, 'brand must now be set');
  // The legacy field must never be touched/removed.
  assert.equal(reloaded.subcategory.toString(), subcategory._id.toString());

  const brand = await Brand.findById(reloaded.brand);
  assert.equal(brand.name.en, 'ACME');
});

test('reuses an existing Brand with a matching name instead of creating a duplicate', async () => {
  const category = await Category.create({ name: { en: 'Cables', ar: 'كابلات' } });
  const subcategory = await SubCategory.create({ name: { en: 'Siemens', ar: 'سيمنس' }, mainCategory: category._id });
  const existingBrand = await Brand.create({ name: { en: 'Siemens', ar: 'سيمنس' } });
  const product = await makeProduct({ category: category._id, subcategory: subcategory._id });

  const result = await migrateSubcategoryToBrand({ connect: false });
  assert.equal(result.migrated[0].created, false);
  assert.equal(await Brand.countDocuments({}), 1, 'no duplicate brand should be created');

  const reloaded = await Product.findById(product._id);
  assert.equal(reloaded.brand.toString(), existingBrand._id.toString());
});

test('never touches a product that already has a brand set', async () => {
  const category = await Category.create({ name: { en: 'Cables', ar: 'كابلات' } });
  const subcategory = await SubCategory.create({ name: { en: 'ACME', ar: 'أكمي' }, mainCategory: category._id });
  const otherBrand = await Brand.create({ name: { en: 'OtherBrand', ar: 'ماركة أخرى' } });
  const product = await makeProduct({ category: category._id, subcategory: subcategory._id, brand: otherBrand._id });

  const result = await migrateSubcategoryToBrand({ connect: false });
  assert.equal(result.found, 0);

  const reloaded = await Product.findById(product._id);
  assert.equal(reloaded.brand.toString(), otherBrand._id.toString());
});

test('skips a product whose subcategory no longer exists, without throwing', async () => {
  const category = await Category.create({ name: { en: 'Cables', ar: 'كابلات' } });
  const subcategory = await SubCategory.create({ name: { en: 'Ghost', ar: 'شبح' }, mainCategory: category._id });
  const product = await makeProduct({ category: category._id, subcategory: subcategory._id });
  await SubCategory.deleteOne({ _id: subcategory._id });

  const result = await migrateSubcategoryToBrand({ connect: false });
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].productId, product._id.toString());

  const reloaded = await Product.findById(product._id);
  assert.equal(reloaded.brand, null);
});

test('is idempotent: running it twice never creates a second brand or re-processes a migrated product', async () => {
  const category = await Category.create({ name: { en: 'Cables', ar: 'كابلات' } });
  const subcategory = await SubCategory.create({ name: { en: 'ACME', ar: 'أكمي' }, mainCategory: category._id });
  await makeProduct({ category: category._id, subcategory: subcategory._id });

  const first = await migrateSubcategoryToBrand({ connect: false });
  assert.equal(first.found, 1);
  const second = await migrateSubcategoryToBrand({ connect: false });
  assert.equal(second.found, 0, 'nothing left to migrate the second time');
  assert.equal(await Brand.countDocuments({}), 1);
});

test('--dry-run reports what would change without writing anything', async () => {
  const category = await Category.create({ name: { en: 'Cables', ar: 'كابلات' } });
  const subcategory = await SubCategory.create({ name: { en: 'ACME', ar: 'أكمي' }, mainCategory: category._id });
  const product = await makeProduct({ category: category._id, subcategory: subcategory._id });

  const result = await migrateSubcategoryToBrand({ connect: false, dryRun: true });
  assert.equal(result.found, 1);
  assert.equal(result.migrated.length, 1);
  assert.equal(await Brand.countDocuments({}), 0, 'dry-run must never create a brand');

  const reloaded = await Product.findById(product._id);
  assert.equal(reloaded.brand, null, 'dry-run must never write');
});
