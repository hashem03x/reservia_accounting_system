/**
 * Product catalog migration: the catalog hierarchy is now Category -> Brand -> Model/Item
 * Number/Specifications (see productModel.js#brand), replacing Category -> Subcategory. This
 * script backfills `Product.brand` for every existing product that still only has the legacy
 * `subcategory` set, by finding-or-creating a Brand with the same name as that product's
 * SubCategory.
 *
 * Non-destructive: only ever $set's `brand` on a product - never touches/removes `subcategory`
 * (kept on the schema for backward compatibility with historical reports/lookups). Idempotent: a
 * product that already has a `brand` is left completely untouched, so re-running this script (or
 * running it against a partially-migrated database) is always safe.
 *
 * Usage:
 *   npm run db:migrate-subcategory-to-brand
 *   npm run db:migrate-subcategory-to-brand -- --dry-run
 */
const mongoose = require('mongoose');
const { loadEnv, SafetyError, assertDbUriConfigured, assertSafeDatabaseName, assertNotLeopardDatabase } = require('./lib/dbSafety');

async function migrateSubcategoryToBrand({ dryRun = process.argv.includes('--dry-run'), connect = true } = {}) {
  if (connect) {
    loadEnv();
    assertDbUriConfigured();
    console.log('Connecting to database...');
    await mongoose.connect(process.env.DB_URI);
  }
  const { connection } = mongoose;
  if (connect) {
    const dbName = assertSafeDatabaseName(connection);
    console.log(`Connected (host: ${connection.host}, db: ${dbName}).`);
    await assertNotLeopardDatabase(connection);
  }

  // eslint-disable-next-line global-require
  const Product = require('../models/inventory/productModel');
  // eslint-disable-next-line global-require
  const SubCategory = require('../models/subCategoryModel');
  // eslint-disable-next-line global-require
  const Brand = require('../models/brandModel');

  const candidates = await Product.find({
    subcategory: { $ne: null },
    brand: null,
  }).select('_id title subcategory');

  console.log(`\nFound ${candidates.length} product(s) with a subcategory but no brand yet.`);

  const migrated = [];
  const skipped = [];

  for (const product of candidates) {
    // eslint-disable-next-line no-await-in-loop
    const subcategory = await SubCategory.findById(product.subcategory).select('name');
    if (!subcategory || !subcategory.name) {
      skipped.push({ productId: product._id.toString(), reason: 'subcategory no longer exists' });
      continue; // eslint-disable-line no-continue
    }

    const name = typeof subcategory.name === 'string' ? { en: subcategory.name, ar: subcategory.name } : subcategory.name;
    if (!name.en) {
      skipped.push({ productId: product._id.toString(), reason: 'subcategory has no usable name' });
      continue; // eslint-disable-line no-continue
    }

    // eslint-disable-next-line no-await-in-loop
    let brand = await Brand.findOne({ 'name.en': name.en });
    let createdBrand = false;
    if (!brand) {
      if (dryRun) {
        migrated.push({ productId: product._id.toString(), brandName: name.en, created: true });
        continue; // eslint-disable-line no-continue
      }
      // eslint-disable-next-line no-await-in-loop
      brand = await Brand.create({ name: { en: name.en, ar: name.ar || name.en } });
      createdBrand = true;
    }

    if (!dryRun) {
      // A targeted $set via updateOne (not fetch-then-.save()) - `candidates` above was only
      // partially selected, and re-saving a partially-selected document would re-run full
      // schema validation against fields that were never loaded (cost/price/description/etc),
      // incorrectly failing. This also keeps the operation a pure, minimal, additive write.
      // eslint-disable-next-line no-await-in-loop
      await Product.updateOne({ _id: product._id }, { $set: { brand: brand._id } });
    }
    migrated.push({ productId: product._id.toString(), brandName: name.en, created: createdBrand });
  }

  console.log(dryRun ? '--dry-run passed - no changes written.' : `Migrated ${migrated.length} product(s) to a brand reference (${skipped.length} skipped).`);
  return { found: candidates.length, migrated, skipped };
}

if (require.main === module) {
  migrateSubcategoryToBrand()
    .then(async () => {
      await mongoose.disconnect();
      process.exit(0);
    })
    .catch(async err => {
      console.error('\ndb:migrate-subcategory-to-brand failed:');
      console.error(err instanceof SafetyError ? err.message : `${err.name}: ${err.message}`);
      await mongoose.disconnect().catch(() => {});
      process.exit(1);
    });
}

module.exports = { migrateSubcategoryToBrand };
