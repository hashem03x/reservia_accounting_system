const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const os = require('os');
const path = require('path');
const fs = require('fs').promises;
const { validationResult } = require('express-validator');

// Client requirement "Products - Category, Brand, Model/Item, Specifications": the catalog hierarchy
// Main Category -> Subcategory -> Brand -> Model/Item -> Specifications, with cost and price NOT
// required to define a product. Services are unchanged (their classification is pending client
// confirmation). No artificial zero-cost value is ever produced for a product without a cost.

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_product_hierarchy';

let Product, Category, SubCategory, Brand, Warehouse, ChartOfAccount, JournalEntry;
let createProductValidator, updateProductValidator, applyPurchaseToProducts, previewImport, productSchema;
let cables, pipes, cablesSub, pipesSub, acme, warehouse, puc;

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  Product = require('../../models/inventory/productModel');
  Category = require('../../models/categoryModel');
  SubCategory = require('../../models/subCategoryModel');
  Brand = require('../../models/brandModel');
  Warehouse = require('../../models/inventory/warehouseModel');
  ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
  JournalEntry = require('../../models/accounting/journalEntryModel');
  ({ createProductValidator, updateProductValidator } = require('../../utils/validators/productValidator'));
  ({ applyPurchaseToProducts } = require('../../controller/PO/purchaseOrderController'));
  ({ previewImport } = require('../../services/csvImport/csvImportRunner'));
  productSchema = require('../../utils/validators/import/productImportSchema');
  await Promise.all([Product.init(), Category.init(), Brand.init()]);
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  await Promise.all([Product, Category, SubCategory, Brand, Warehouse, ChartOfAccount, JournalEntry].map(M => M.deleteMany({})));
  cables = await Category.create({ name: { en: 'Electrical Materials', ar: 'مواد كهربائية' } });
  pipes = await Category.create({ name: { en: 'Plumbing', ar: 'سباكة' } });
  cablesSub = await SubCategory.create({ name: { en: 'Cables', ar: 'كابلات' }, mainCategory: cables._id });
  pipesSub = await SubCategory.create({ name: { en: 'Pipes', ar: 'مواسير' }, mainCategory: pipes._id });
  acme = await Brand.create({ name: { en: 'ACME', ar: 'أكمي' } });
  warehouse = await Warehouse.create({ name: 'Main Warehouse', location: 'Cairo' });
  puc = await ChartOfAccount.create({ code: '11000009', name: 'PUC - Raw Materials', type: 'asset', isActive: true });
});

const user = { _id: new mongoose.Types.ObjectId(), role: 'admin' };
async function errorsOf(validators, body, params = {}) {
  const req = { body, params, query: {}, user };
  for (const v of validators) if (typeof v.run === 'function') await v.run(req);
  return validationResult(req)
    .array()
    .map(e => e.msg);
}
const productBody = extra => ({
  title: { en: 'Copper Cable', ar: 'كابل نحاس' },
  description: { en: 'Cable', ar: 'كابل' },
  type: 'product',
  category: String(cables._id),
  subcategory: String(cablesSub._id),
  brand: String(acme._id),
  model: 'CX-10',
  specifications: '10mm, PVC',
  ...extra,
});

test('a product can be defined without cost or price; the full hierarchy is stored', async () => {
  assert.deepEqual(await errorsOf(createProductValidator, productBody()), []);
  const product = await Product.create({ ...productBody(), createdBy: user._id });
  assert.equal(product.cost, undefined);
  assert.equal(product.price, undefined);
  assert.equal(String(product.subcategory), String(cablesSub._id));
  assert.equal(product.model, 'CX-10');
  assert.equal(await JournalEntry.countDocuments({}), 0, 'defining a product never posts anything');

  // Negative / non-numeric values are still refused.
  assert.ok((await errorsOf(createProductValidator, productBody({ price: -1 }))).some(m => /price/i.test(m)));
  assert.ok((await errorsOf(createProductValidator, productBody({ cost: 'abc' }))).some(m => /cost/i.test(m)));
});

test('the Subcategory must belong to the selected Main Category (create and update)', async () => {
  const wrong = await errorsOf(createProductValidator, productBody({ subcategory: String(pipesSub._id) }));
  assert.ok(wrong.some(m => /does not belong/.test(m)));
  const withoutCategory = await errorsOf(createProductValidator, productBody({ category: undefined }));
  assert.ok(withoutCategory.some(m => /Main Category|Category is required/.test(m)));

  // Update with only a subcategory is checked against the STORED category.
  const product = await Product.create({ ...productBody(), createdBy: user._id });
  assert.ok((await errorsOf(updateProductValidator, { subcategory: String(pipesSub._id) }, { id: String(product._id) })).some(m => /does not belong/.test(m)));
  assert.deepEqual(await errorsOf(updateProductValidator, { subcategory: String(cablesSub._id) }, { id: String(product._id) }), []);
});

test('services are unchanged (classification pending client confirmation): no category, brand or model is required', async () => {
  const service = {
    title: { en: 'Cable Installation', ar: 'تركيب كابلات' },
    description: { en: 'Service', ar: 'خدمة' },
    type: 'service',
    durationValue: 1,
    durationUnit: 'month',
    pucAccount: String(puc._id),
  };
  assert.deepEqual(await errorsOf(createProductValidator, service), []);
});

test('a product without a cost takes its first purchase cost - never NaN or an artificial zero', async () => {
  const product = await Product.create({ ...productBody(), createdBy: user._id, stock: [{ warehouse: warehouse._id, quantity: 5 }] });
  await applyPurchaseToProducts({ items: [{ productId: product._id, starterQuantity: 10, unitPriceAfterDiscount: 40 }] }, String(warehouse._id), null);
  const after1 = await Product.findById(product._id).lean();
  assert.equal(after1.cost, 40, 'the purchase cost, not an average with an unknown-value stock');
  assert.equal(after1.stock[0].quantity, 15);

  // Once a cost exists, the usual moving average applies.
  await applyPurchaseToProducts({ items: [{ productId: product._id, starterQuantity: 5, unitPriceAfterDiscount: 80 }] }, String(warehouse._id), null);
  const after2 = await Product.findById(product._id).lean();
  assert.equal(after2.cost, (15 * 40 + 5 * 80) / 20);
});

test('product CSV import: Price and Cost optional; SubcategoryName must belong to CategoryName; old templates without the column still import', async () => {
  const header = 'TitleEn,TitleAr,DescriptionEn,DescriptionAr,Type,Price,Cost,CategoryName,SubcategoryName,BrandName';
  const write = async content => {
    const file = path.join(os.tmpdir(), `hierarchy-${Date.now()}-${Math.random().toString(36).slice(2)}.csv`);
    await fs.writeFile(file, Buffer.from(content, 'utf8'));
    return { path: file };
  };
  const ok = await previewImport(await write(`${header}\nCopper Cable,كابل نحاس,d,د,product,,,Electrical Materials,Cables,ACME\n`), productSchema);
  assert.equal(ok.validCount, 1, JSON.stringify(ok.errors));

  const bad = await previewImport(await write(`${header}\nCopper Cable,كابل نحاس,d,د,product,,,Electrical Materials,Pipes,ACME\n`), productSchema);
  assert.equal(bad.validCount, 0);
  const messages = bad.errors.flatMap(r => r.errors.map(e => e.message));
  assert.ok(messages.includes('No subcategory named "Pipes" under category "Electrical Materials".'), JSON.stringify(messages));

  const legacy = await previewImport(await write(`TitleEn,TitleAr,DescriptionEn,DescriptionAr,Type,Price,Cost,CategoryName,BrandName\nSteel Pipe,ماسورة,d,د,product,10,5,Plumbing,ACME\n`), productSchema);
  assert.equal(legacy.validCount, 1, JSON.stringify(legacy.errors));
});
