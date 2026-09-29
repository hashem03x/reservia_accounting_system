const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_product_type';

let Product;
let Category;
let SubCategory;
let category;
let subcategory;

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();

  Product = require('../models/inventory/productModel');
  Category = require('../models/categoryModel');
  SubCategory = require('../models/subCategoryModel');
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  await Product.deleteMany({});
  await Category.deleteMany({});
  await SubCategory.deleteMany({});
  category = await Category.create({ name: { en: 'Cat', ar: 'فئة' } });
  subcategory = await SubCategory.create({ name: { en: 'Sub', ar: 'فئة فرعية' }, mainCategory: category._id });
});

test('a product requires cost/category/subcategory at the schema level', async () => {
  const product = new Product({
    type: 'product',
    title: { en: 'Shirt', ar: 'قميص' },
    description: { en: 'desc', ar: 'وصف' },
    price: 100,
    // cost/category/subcategory intentionally omitted
  });
  await assert.rejects(() => product.validate());
});

test('a service does NOT require cost/category/subcategory, but does require a positive durationValue', async () => {
  const service = new Product({
    type: 'service',
    title: { en: 'Maintenance', ar: 'صيانة' },
    description: { en: 'desc', ar: 'وصف' },
    price: 500,
    durationValue: 12,
    durationUnit: 'month',
  });
  await service.validate(); // Must not throw despite no cost/category/subcategory.
  assert.equal(service.cost, undefined);

  const invalidService = new Product({
    type: 'service',
    title: { en: 'Maintenance 2', ar: 'صيانة 2' },
    description: { en: 'desc', ar: 'وصف' },
    price: 500,
  });
  await assert.rejects(() => invalidService.validate(), /duration/i);
});

test('saving a valid service persists with zero stock-tracked variants', async () => {
  const service = await Product.create({
    type: 'service',
    title: { en: 'Support Plan', ar: 'خطة دعم' },
    description: { en: 'desc', ar: 'وصف' },
    price: 300,
    durationValue: 6,
    durationUnit: 'month',
  });

  assert.equal(service.type, 'service');
  assert.equal(service.variants.length, 0);
});

test('a service can never be saved with variants attached (model-level guard)', async () => {
  const service = new Product({
    type: 'service',
    title: { en: 'Bad Service', ar: 'خدمة خاطئة' },
    description: { en: 'desc', ar: 'وصف' },
    price: 100,
    durationValue: 1,
    durationUnit: 'month',
    variants: [new mongoose.Types.ObjectId()],
  });
  await assert.rejects(() => service.save(), /cannot have inventory variants/i);
});

test('a regular product still saves normally with cost/category/subcategory (existing behavior preserved)', async () => {
  const product = await Product.create({
    type: 'product',
    title: { en: 'Jeans', ar: 'جينز' },
    description: { en: 'desc', ar: 'وصف' },
    cost: 80,
    price: 150,
    category: category._id,
    subcategory: subcategory._id,
  });
  assert.equal(product.type, 'product');
  assert.equal(product.cost, 80);
});
