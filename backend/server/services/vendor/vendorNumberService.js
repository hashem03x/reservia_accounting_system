const Counter = require('../../models/config/counterModel');
const ApiError = require('../../utils/apiError');

// Mirror of customerNumberService.js's atomic counter pattern - a Vendor's own identifying number,
// shown as the vendor's "Sub Account" on journal-entry/general-ledger lines (see docs section "Sub
// Account Mapping").
//
// Vendor numbers are 5-digit numbers that always start with 2 (20001, 20002, ... 29999). The range
// is a business rule, not a deployment setting, so it is deliberately NOT env-overridable (the old
// VENDOR_NUMBER_RANGE_START/END variables are ignored) - a misconfigured env must never be able to
// issue a vendor number outside 2xxxx. Customer numbering is a separate counter and is unaffected.
//
// Existing vendors keep the numbers they already have (vendorNumber is immutable) - only newly
// created vendors get 2xxxx numbers. Those older numbers (issued from 1000 upwards) can never
// collide with this range.

const SEQUENCE_NAME = 'vendorNumber';

const RANGE_MIN = 20001;
const RANGE_MAX = 29999;

const isValidVendorNumber = value => Number.isInteger(value) && value >= RANGE_MIN && value <= RANGE_MAX;

/**
 * Moves the shared counter document into the 2xxxx range (idempotent, safe under concurrency).
 *
 * `$max` only ever raises `seq`, so:
 *   - a brand-new counter is created at RANGE_MIN - 1,
 *   - a counter left over from the old 1000+ scheme jumps straight to RANGE_MIN - 1,
 *   - a counter already inside the range is never moved backwards (no number is ever reissued).
 * The highest vendorNumber already stored inside the range is folded in as well, so the counter
 * can never hand out a number some existing vendor already has (unique index backstop aside).
 */
async function ensureCounterInRange() {
  // eslint-disable-next-line global-require
  const Vendor = require('../../models/vendor/vendor');
  const highestInRange = await Vendor.findOne({ vendorNumber: { $gte: RANGE_MIN, $lte: RANGE_MAX } })
    .sort({ vendorNumber: -1 })
    .select('vendorNumber')
    .lean();
  const floor = Math.max(RANGE_MIN - 1, highestInRange?.vendorNumber || 0);

  try {
    await Counter.updateOne({ _id: SEQUENCE_NAME }, { $max: { seq: floor }, $set: { min: RANGE_MIN, max: RANGE_MAX } }, { upsert: true });
  } catch (err) {
    // Two requests racing to upsert the same missing _id - the loser's insert hits E11000. The
    // winner already wrote the same values, so retry once as a plain update.
    if (err.code !== 11000) throw err;
    await Counter.updateOne({ _id: SEQUENCE_NAME }, { $max: { seq: floor }, $set: { min: RANGE_MIN, max: RANGE_MAX } });
  }
}

/**
 * Atomically allocates the next vendor number (2xxxx). Same concurrency/exhaustion guarantees as
 * getNextCustomerNumber(): a single guarded $inc, never "count + 1", and a clear business error
 * instead of wrapping around once 29999 has been issued.
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
