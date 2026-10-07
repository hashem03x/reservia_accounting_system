const Counter = require('../../models/config/counterModel');
const ApiError = require('../../utils/apiError');

// Mirror of customerNumberService.js's atomic counter pattern - a Vendor's own identifying number,
// shown as the vendor's "Sub Account" on journal-entry/general-ledger lines (see docs section "Sub
// Account Mapping").
//
// Vendor numbers start at 2000 and increment by one (2000, 2001, ... 2999). The range is a
// business rule, not a deployment setting, so it is deliberately NOT env-overridable (the old
// VENDOR_NUMBER_RANGE_START/END variables are ignored). The `vendorNumber` counter document is
// used only by vendors - Customer numbering is its own `customerNumber` counter and is unaffected.
//
// Existing vendors keep the numbers they already have (vendorNumber is immutable). Any existing
// vendor whose number already falls inside 2000-2999 is respected: numbering continues from the
// highest such number + 1, so no number is ever issued twice.

const SEQUENCE_NAME = 'vendorNumber';

const RANGE_MIN = 2000;
const RANGE_MAX = 2999;

const isValidVendorNumber = value => Number.isInteger(value) && value >= RANGE_MIN && value <= RANGE_MAX;

/**
 * Brings the counter document onto the 2000-2999 range (idempotent, safe under concurrency and
 * across restarts/deployments - all state lives in the `counters` collection).
 *
 * `floor` is the last number that must never be issued again: RANGE_MIN - 1 on a fresh database,
 * otherwise the highest vendorNumber already stored inside the range.
 *
 *   1. One-time migration of a counter left over from an older scheme (its stored min/max differ,
 *      e.g. the original 1000-999999 counter or the short-lived 20001-29999 one): its `seq` is
 *      re-based onto the new range - kept if it is already inside the range (never moved
 *      backwards), otherwise reset to `floor`. The filter matches the old min/max, so when two
 *      requests race only the first one migrates; the second no longer matches.
 *   2. `$max` then only ever raises `seq` to `floor` (creating the counter at `floor` if missing),
 *      so the counter can never be behind an existing vendor's number.
 */
async function ensureCounterInRange() {
  // eslint-disable-next-line global-require
  const Vendor = require('../../models/vendor/vendor');
  const highestInRange = await Vendor.findOne({ vendorNumber: { $gte: RANGE_MIN, $lte: RANGE_MAX } })
    .sort({ vendorNumber: -1 })
    .select('vendorNumber')
    .lean();
  const floor = Math.max(RANGE_MIN - 1, highestInRange?.vendorNumber || 0);

  await Counter.updateOne({ _id: SEQUENCE_NAME, $or: [{ min: { $ne: RANGE_MIN } }, { max: { $ne: RANGE_MAX } }] }, [
    {
      $set: {
        seq: {
          $cond: [{ $and: [{ $gte: ['$seq', RANGE_MIN - 1] }, { $lte: ['$seq', RANGE_MAX] }] }, { $max: ['$seq', floor] }, floor],
        },
        min: RANGE_MIN,
        max: RANGE_MAX,
      },
    },
  ]);

  try {
    await Counter.updateOne({ _id: SEQUENCE_NAME }, { $max: { seq: floor }, $setOnInsert: { min: RANGE_MIN, max: RANGE_MAX } }, { upsert: true });
  } catch (err) {
    // Two requests racing to upsert the same missing _id - the loser's insert hits E11000. The
    // winner already created the document, so retry once as a plain update.
    if (err.code !== 11000) throw err;
    await Counter.updateOne({ _id: SEQUENCE_NAME }, { $max: { seq: floor } });
  }
}

/**
 * Atomically allocates the next vendor number (2000, 2001, ...). Same concurrency/exhaustion
 * guarantees as getNextCustomerNumber(): a single guarded $inc, never "count + 1", and a clear
 * business error instead of wrapping around once 2999 has been issued. The unique index on
 * vendors.vendorNumber is the final backstop against duplicates.
 */
async function getNextVendorNumber() {
  await ensureCounterInRange();

  const updated = await Counter.findOneAndUpdate({ _id: SEQUENCE_NAME, $expr: { $lt: ['$seq', '$max'] } }, { $inc: { seq: 1 } }, { new: true });

  if (!updated || !isValidVendorNumber(updated.seq)) {
    throw new ApiError(`Vendor number range (${RANGE_MIN}-${RANGE_MAX}) is exhausted. Ask an administrator to review vendor numbering.`, 400);
  }

  return updated.seq;
}

module.exports = { getNextVendorNumber, isValidVendorNumber, SEQUENCE_NAME, RANGE_MIN, RANGE_MAX };
