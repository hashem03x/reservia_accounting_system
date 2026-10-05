const Counter = require('../../models/config/counterModel');
const ApiError = require('../../utils/apiError');

// Exact mirror of customerNumberService.js's atomic counter pattern - a Vendor's own identifying
// number, needed so journal-entry/general-ledger "Sub Account" display can show a real Vendor
// Number instead of a MongoDB _id or a name (see docs section "Sub Account Mapping"). No vendor
// document had one before this field existed, so this only ever applies going forward - a vendor
// created before this field existed simply has none (shown as "-", never fabricated).

const SEQUENCE_NAME = 'vendorNumber';

const RANGE_MIN = parseInt(process.env.VENDOR_NUMBER_RANGE_START, 10) || 1000;
const RANGE_MAX = parseInt(process.env.VENDOR_NUMBER_RANGE_END, 10) || 999999;

/**
 * Atomically allocates the next vendor number from the configured range - identical mechanism to
 * getNextCustomerNumber() (see that file's comment for the concurrency/exhaustion reasoning).
 */
async function getNextVendorNumber() {
  try {
    await Counter.create({ _id: SEQUENCE_NAME, seq: RANGE_MIN - 1, min: RANGE_MIN, max: RANGE_MAX });
  } catch (err) {
    if (err.code !== 11000) throw err;
  }

  const updated = await Counter.findOneAndUpdate(
    { _id: SEQUENCE_NAME, $expr: { $lt: ['$seq', '$max'] } },
    { $inc: { seq: 1 } },
    { new: true }
  );

  if (!updated) {
    const counter = await Counter.findById(SEQUENCE_NAME);
    const range = counter ? `${counter.min}-${counter.max}` : `${RANGE_MIN}-${RANGE_MAX}`;
    throw new ApiError(`Vendor number range (${range}) is exhausted. Ask an administrator to configure a new range.`, 400);
  }

  return updated.seq;
}

module.exports = { getNextVendorNumber, SEQUENCE_NAME, RANGE_MIN, RANGE_MAX };
