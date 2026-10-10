/**
 * Gives every fixed asset that has no Asset Number (assets created before numbering existed) the
 * next one, oldest first. Idempotent - assets that already have a number are never changed, and
 * running it twice does nothing the second time. Only touches FixedAsset.assetNumber.
 *
 *   node server/scripts/backfillFixedAssetNumbers.js            (dry run - prints what it would do)
 *   node server/scripts/backfillFixedAssetNumbers.js --apply
 */
const path = require('path');
const mongoose = require('mongoose');

require('dotenv').config({ path: path.join(__dirname, '..', '..', 'config.env') });

(async () => {
  const apply = process.argv.includes('--apply');
  const uri = process.env.DB_URI;
  if (!uri) throw new Error('DB_URI is not set.');
  await mongoose.connect(uri);
  const FixedAsset = require('../models/fixedAssets');
  const { getNextFixedAssetNumber, formatAssetNumber } = require('../services/fixedAssets/fixedAssetNumberService');

  const missing = await FixedAsset.collection.find({ $or: [{ assetNumber: null }, { assetNumber: { $exists: false } }] }, { projection: { name: 1, createdAt: 1 } }).sort({ createdAt: 1, _id: 1 }).toArray();
  console.log(`${missing.length} fixed asset(s) without an Asset Number.${apply ? '' : ' Dry run - pass --apply to assign numbers.'}`);
  for (const asset of missing) {
    if (apply) {
      const number = await getNextFixedAssetNumber();
      const { modifiedCount } = await FixedAsset.collection.updateOne({ _id: asset._id, $or: [{ assetNumber: null }, { assetNumber: { $exists: false } }] }, { $set: { assetNumber: number } });
      console.log(`${modifiedCount ? formatAssetNumber(number) : 'skipped (numbered meanwhile)'}  ${asset.name}`);
    } else console.log(`would number  ${asset.name}`);
  }
  await mongoose.disconnect();
})().catch(async err => {
  console.error(err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
