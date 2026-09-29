const Counter = require('../../models/config/counterModel');
const ApiError = require('../../utils/apiError');

const SEQUENCE_NAME = 'customerNumber';

// Configurable range - see docs/environment-variables.md. Defaults chosen to leave obvious room
// below 1000 for any future manual/legacy numbering scheme without colliding with it.
const RANGE_MIN = parseInt(process.env.CUSTOMER_NUMBER_RANGE_START, 10) || 1000;
const RANGE_MAX = parseInt(process.env.CUSTOMER_NUMBER_RANGE_END, 10) || 999999;

/**
 * Atomically allocates the next customer number from the configured range.
 *
 * Concurrency: the actual increment is a single findOneAndUpdate({ $inc }) - MongoDB serializes
 * writes to the same document, so two requests racing to create a customer at the same instant
 * cannot observe or receive the same number (unlike a "count documents, then +1" scheme, which
 * this deliberately avoids - see counterModel.js's comment).
 *
 * Range exhaustion: once `seq` reaches `max`, the guarded update matches zero documents and this
 * throws a clear business error instead of wrapping around and reissuing an old number.
 */
async function getNextCustomerNumber() {
  // Ensure the counter document exists exactly once. If two requests race here, the loser's
  // insert fails with a duplicate-key error (E11000 on _id) - not a real failure, it just means
  // the other request already created the seed document, so it's safe to ignore and continue.
  try {
    await Counter.create({ _id: SEQUENCE_NAME, seq: RANGE_MIN - 1, min: RANGE_MIN, max: RANGE_MAX });
  } catch (err) {
    if (err.code !== 11000) throw err;
  }

  // Matches on the counter document's OWN stored `max` (via $expr), not the env-derived
  // RANGE_MAX constant, so an administrator can widen the range later by editing this one
  // document without needing a redeploy - the env vars only seed it the first time.
  const updated = await Counter.findOneAndUpdate(
    { _id: SEQUENCE_NAME, $expr: { $lt: ['$seq', '$max'] } },
    { $inc: { seq: 1 } },
    { new: true }
  );

  if (!updated) {
    const counter = await Counter.findById(SEQUENCE_NAME);
    const range = counter ? `${counter.min}-${counter.max}` : `${RANGE_MIN}-${RANGE_MAX}`;
    throw new ApiError(`Customer number range (${range}) is exhausted. Ask an administrator to configure a new range.`, 400);
  }

  return updated.seq;
}

module.exports = { getNextCustomerNumber, SEQUENCE_NAME, RANGE_MIN, RANGE_MAX };
