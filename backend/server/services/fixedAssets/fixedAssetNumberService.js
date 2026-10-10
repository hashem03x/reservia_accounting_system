const Counter = require('../../models/config/counterModel');

// Fixed Asset numbers (FA-0001, FA-0002, ...) - the same atomic counter pattern as customer and
// vendor numbers (models/config/counterModel.js): a single $inc, never "count + 1". Assets created
// before numbering existed get theirs from scripts/backfillFixedAssetNumbers.js; the counter never
// issues a number that is already used.

const SEQUENCE_NAME = 'fixedAssetNumber';
const MIN = 1;
const MAX = 999999;

const formatAssetNumber = n => (n ? `FA-${String(n).padStart(4, '0')}` : null);

async function ensureCounter() {
  // eslint-disable-next-line global-require
  const FixedAsset = require('../../models/fixedAssets');
  const highest = await FixedAsset.findOne({ assetNumber: { $ne: null } }).sort({ assetNumber: -1 }).select('assetNumber').lean();
  const floor = Math.max(MIN - 1, highest?.assetNumber || 0);
  try {
    await Counter.updateOne({ _id: SEQUENCE_NAME }, { $max: { seq: floor }, $setOnInsert: { min: MIN, max: MAX } }, { upsert: true });
  } catch (err) {
    if (err.code !== 11000) throw err;
    await Counter.updateOne({ _id: SEQUENCE_NAME }, { $max: { seq: floor } });
  }
}

async function getNextFixedAssetNumber() {
  await ensureCounter();
  const updated = await Counter.findOneAndUpdate({ _id: SEQUENCE_NAME, $expr: { $lt: ['$seq', '$max'] } }, { $inc: { seq: 1 } }, { new: true });
  if (!updated) throw new Error('The fixed asset number range is exhausted.');
  return updated.seq;
}

module.exports = { getNextFixedAssetNumber, formatAssetNumber };
