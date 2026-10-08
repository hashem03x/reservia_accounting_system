const Counter = require('../../models/config/counterModel');
const ApiError = require('../../utils/apiError');

const SEQUENCE_NAME = 'shareholderNumber';
const RANGE_MIN = 1;
const RANGE_MAX = 999999;

/**
 * Atomically allocates the next Shareholder Number - the same single-$inc counter scheme as
 * customerNumberService.js / vendorNumberService.js, so concurrent creations never share a number.
 * Deliberately outside any transaction (like those services): the seed insert's expected
 * duplicate-key error would otherwise abort the caller's transaction.
 */
async function getNextShareholderNumber() {
  try {
    await Counter.create({ _id: SEQUENCE_NAME, seq: RANGE_MIN - 1, min: RANGE_MIN, max: RANGE_MAX });
  } catch (err) {
    if (err.code !== 11000) throw err;
  }

  const updated = await Counter.findOneAndUpdate({ _id: SEQUENCE_NAME, $expr: { $lt: ['$seq', '$max'] } }, { $inc: { seq: 1 } }, { new: true });
  if (!updated) throw new ApiError(`Shareholder number range (${RANGE_MIN}-${RANGE_MAX}) is exhausted.`, 400);
  return updated.seq;
}

module.exports = { getNextShareholderNumber, SEQUENCE_NAME };
