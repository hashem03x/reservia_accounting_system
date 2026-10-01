/**
 * Seeds dummy Category/SubCategory data for Reversia's Integrated Energy / Industrial Systems
 * business scope (solar, wind, power generation, electrical distribution, HVAC, water treatment,
 * industrial automation, energy storage) - useful for exercising the Product form's Category/
 * Subcategory pickers without hand-creating them one by one in the admin UI.
 *
 * Additive and idempotent by design, like db:seed-accounts:
 *  - Safe to run against a database that already has real data.
 *  - Upserts by `slug` using $setOnInsert only, so re-running never overwrites a category/
 *    subcategory an admin has already edited - it only creates the ones that don't exist yet.
 *
 * Usage: npm run db:seed-industrial-categories
 */
const mongoose = require('mongoose');
const { loadEnv, assertDbUriConfigured, assertSafeDatabaseName, assertNotLeopardDatabase, SafetyError } = require('./lib/dbSafety');

const CATEGORIES = [
  {
    slug: 'solar-energy-systems',
    name: { en: 'Solar Energy Systems', ar: 'أنظمة الطاقة الشمسية' },
    subcategories: [
      { slug: 'solar-panels', name: { en: 'Solar Panels (PV Modules)', ar: 'الألواح الشمسية' } },
      { slug: 'solar-inverters', name: { en: 'Solar Inverters', ar: 'عاكسات الطاقة الشمسية' } },
      { slug: 'solar-batteries-storage', name: { en: 'Solar Batteries & Storage', ar: 'بطاريات وتخزين الطاقة الشمسية' } },
    ],
  },
  {
    slug: 'wind-energy-systems',
    name: { en: 'Wind Energy Systems', ar: 'أنظمة طاقة الرياح' },
    subcategories: [
      { slug: 'wind-turbines', name: { en: 'Wind Turbines', ar: 'توربينات الرياح' } },
      { slug: 'wind-turbine-controllers', name: { en: 'Wind Turbine Controllers', ar: 'وحدات تحكم توربينات الرياح' } },
      { slug: 'wind-towers-masts', name: { en: 'Wind Towers & Masts', ar: 'أبراج وصواري الرياح' } },
    ],
  },
  {
    slug: 'power-generation',
    name: { en: 'Power Generation', ar: 'توليد الطاقة' },
    subcategories: [
      { slug: 'diesel-generators', name: { en: 'Diesel Generators', ar: 'مولدات الديزل' } },
      { slug: 'gas-generators', name: { en: 'Gas Generators', ar: 'مولدات الغاز' } },
      { slug: 'generator-control-panels', name: { en: 'Generator Control Panels', ar: 'لوحات تحكم المولدات' } },
    ],
  },
  {
    slug: 'electrical-distribution',
    name: { en: 'Electrical Distribution', ar: 'التوزيع الكهربائي' },
    subcategories: [
      { slug: 'transformers', name: { en: 'Transformers', ar: 'المحولات الكهربائية' } },
      { slug: 'switchgear', name: { en: 'Switchgear', ar: 'أجهزة التحكم والتبديل الكهربائي' } },
      { slug: 'circuit-breakers-cables', name: { en: 'Circuit Breakers & Cables', ar: 'قواطع الدوائر والكابلات' } },
    ],
  },
  {
    slug: 'hvac-systems',
    name: { en: 'HVAC Systems', ar: 'أنظمة التكييف والتهوية' },
    subcategories: [
      { slug: 'industrial-chillers', name: { en: 'Industrial Chillers', ar: 'مبردات صناعية' } },
      { slug: 'air-handling-units', name: { en: 'Air Handling Units', ar: 'وحدات معالجة الهواء' } },
      { slug: 'ventilation-fans', name: { en: 'Ventilation Fans', ar: 'مراوح التهوية' } },
    ],
  },
  {
    slug: 'water-treatment-pumping',
    name: { en: 'Water Treatment & Pumping', ar: 'معالجة المياه والضخ' },
    subcategories: [
      { slug: 'industrial-pumps', name: { en: 'Industrial Pumps', ar: 'مضخات صناعية' } },
      { slug: 'water-filtration-systems', name: { en: 'Water Filtration Systems', ar: 'أنظمة ترشيح المياه' } },
      { slug: 'wastewater-treatment-equipment', name: { en: 'Wastewater Treatment Equipment', ar: 'معدات معالجة مياه الصرف' } },
    ],
  },
  {
    slug: 'industrial-automation',
    name: { en: 'Industrial Automation', ar: 'الأتمتة الصناعية' },
    subcategories: [
      { slug: 'plcs-controllers', name: { en: 'PLCs & Controllers', ar: 'وحدات التحكم المنطقي القابلة للبرمجة' } },
      { slug: 'scada-systems', name: { en: 'SCADA Systems', ar: 'أنظمة سكادا' } },
      { slug: 'sensors-instrumentation', name: { en: 'Sensors & Instrumentation', ar: 'أجهزة الاستشعار والقياس' } },
    ],
  },
  {
    slug: 'energy-storage-systems',
    name: { en: 'Energy Storage Systems', ar: 'أنظمة تخزين الطاقة' },
    subcategories: [
      { slug: 'lithium-ion-battery-banks', name: { en: 'Lithium-Ion Battery Banks', ar: 'بطاريات ليثيوم أيون' } },
      { slug: 'ups-systems', name: { en: 'UPS Systems', ar: 'أنظمة الطاقة اللا منقطعة' } },
      { slug: 'flywheel-storage', name: { en: 'Flywheel Storage', ar: 'تخزين الطاقة بالدولاب الموازن' } },
    ],
  },
];

async function seedIndustrialCategories() {
  loadEnv();
  assertDbUriConfigured();

  console.log('Connecting to database...');
  const mongooseConn = await mongoose.connect(process.env.DB_URI);
  const connection = mongooseConn.connection;
  const dbName = assertSafeDatabaseName(connection);
  console.log(`Connected (host: ${connection.host}, db: ${dbName}).`);

  await assertNotLeopardDatabase(connection);

  const Category = require('../models/categoryModel');
  const SubCategory = require('../models/subCategoryModel');

  let categoriesCreated = 0;
  let subcategoriesCreated = 0;
  let totalSubcategories = 0;

  for (const { slug, name, subcategories } of CATEGORIES) {
    const categoryResult = await Category.findOneAndUpdate(
      { slug },
      { $setOnInsert: { slug, name, isDeleted: false } },
      { upsert: true, new: true, rawResult: true }
    );
    const categoryCreated = !categoryResult.lastErrorObject?.updatedExisting;
    if (categoryCreated) categoriesCreated++;
    const categoryId = categoryResult.value._id;
    console.log(`- ${name.en}: ${categoryCreated ? 'created' : 'already exists, left untouched'}`);

    for (const sub of subcategories) {
      totalSubcategories++;
      const subResult = await SubCategory.findOneAndUpdate(
        { slug: sub.slug, mainCategory: categoryId },
        { $setOnInsert: { slug: sub.slug, name: sub.name, mainCategory: categoryId, display: true } },
        { upsert: true, new: true, rawResult: true }
      );
      const subCreated = !subResult.lastErrorObject?.updatedExisting;
      if (subCreated) subcategoriesCreated++;
      console.log(`    - ${sub.name.en}: ${subCreated ? 'created' : 'already exists, left untouched'}`);
    }
  }

  console.log(
    `\nSeed complete: ${categoriesCreated}/${CATEGORIES.length} categor${categoriesCreated === 1 ? 'y' : 'ies'} created, ` +
      `${subcategoriesCreated}/${totalSubcategories} subcategories created (rest already existed).`
  );
}

seedIndustrialCategories()
  .then(async () => {
    await mongoose.disconnect();
    console.log('Disconnected. Done.');
    process.exit(0);
  })
  .catch(async err => {
    console.error('\ndb:seed-industrial-categories failed:');
    if (err instanceof SafetyError) {
      console.error(err.message);
    } else {
      console.error(err);
    }
    try {
      await mongoose.disconnect();
    } catch {
      // already disconnected / never connected - nothing to clean up
    }
    process.exit(1);
  });
