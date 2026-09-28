/**
 * One-time sweep to fix corrupted `tags` values already sitting in the database (see
 * utils/helper.js's normalizeTags/unwrapCorruptedTag doc comments for the exact corrupted shapes:
 * a JSON-encoded array, a JSON-quoted string, or a Python-style list literal stored as a single
 * tag string instead of a plain tag). The Product model's post('init')/pre('save') hooks already
 * make every API response clean and every future save clean going forward - this script is only
 * needed to fix what's already sitting in storage (so e.g. a raw DB query or an export sees clean
 * data too, not just this application's own API).
 *
 * Safe to run more than once - products with already-clean tags are left untouched (skipped, not
 * re-saved), so this can't bump every product's updatedAt just by running it again.
 *
 * Usage: node server/scripts/cleanCorruptedTags.js
 */
const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config({ path: 'config.env' });

const Product = require('../models/inventory/productModel');
const { normalizeTags } = require('../utils/helper');

async function cleanCorruptedTags() {
  await mongoose.connect(process.env.DB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  console.log('Connected to MongoDB...');

  // Bypass the post('init') hook's in-memory cleanup with .lean() so we see (and can report on)
  // the RAW stored value, not the already-repaired in-memory representation.
  const products = await Product.find({}, { tags: 1 }).lean();

  let checked = 0;
  let fixed = 0;
  const details = [];

  for (const product of products) {
    checked += 1;
    const before = Array.isArray(product.tags) ? product.tags : [];
    const after = normalizeTags(before);
    const changed = before.length !== after.length || before.some((tag, i) => tag !== after[i]);
    if (!changed) continue;

    await Product.updateOne({ _id: product._id }, { $set: { tags: after } });
    fixed += 1;
    details.push({ productId: product._id.toString(), before, after });
  }

  console.log(`\nChecked ${checked} products, fixed ${fixed} with corrupted tags.\n`);
  for (const { productId, before, after } of details) {
    console.log(`  ${productId}: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
  }

  await mongoose.disconnect();
}

cleanCorruptedTags().catch(err => {
  console.error('Error cleaning corrupted tags:', err);
  process.exitCode = 1;
});
