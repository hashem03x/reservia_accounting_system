const Counter = require('../../models/config/counterModel');
const ApiError = require('../../utils/apiError');

// Replaces the old `generateSalesOrderCode`/`generatePurchaseOrderCode` (utils/helper.js), which
// used `Model.countDocuments({}) + 1` - race-prone under concurrent creates (two simultaneous
// orders could read the same count and be assigned the same code). Mirrors
// journalEntryNumberService.js's atomic counter pattern exactly (fast-path-first increment,
// session-aware seed-on-first-use, E11000-tolerant race handling) - parameterized by `sequenceName`
// so both Sales Order and Purchase Order codes can share this one implementation. Output format is
// UNCHANGED (12-digit zero-padded) - only the generation mechanism is now atomic, so existing
// codes/sorting/display stay fully compatible.
function formatOrderCode(seq) {
  return String(seq).padStart(12, '0');
}

async function getNextOrderNumber(sequenceName, rangeMin, rangeMax, session) {
  let updated = await Counter.findOneAndUpdate(
    { _id: sequenceName, $expr: { $lt: ['$seq', '$max'] } },
    { $inc: { seq: 1 } },
    { new: true, session }
  );

  if (!updated) {
    // Slow path: always retry the increment once after attempting to seed, regardless of whether
    // we won the seed race or a concurrent caller did (Counter.create's E11000 catch below makes
    // either outcome safe) - see projectNumberService.js's identical comment for why a prior
    // "only retry if findById still reports missing" version could race and falsely report the
    // range as exhausted under concurrent first-time allocation.
    try {
      await Counter.create([{ _id: sequenceName, seq: rangeMin - 1, min: rangeMin, max: rangeMax }], { session });
    } catch (err) {
      if (err.code !== 11000) throw err; // lost the seed race to a concurrent first-ever caller - fine
    }
    updated = await Counter.findOneAndUpdate(
      { _id: sequenceName, $expr: { $lt: ['$seq', '$max'] } },
      { $inc: { seq: 1 } },
      { new: true, session }
    );
  }

  if (!updated) {
    const counter = await Counter.findById(sequenceName).session(session || null);
    const range = counter ? `${counter.min}-${counter.max}` : `${rangeMin}-${rangeMax}`;
    throw new ApiError(`Order number range (${range}) is exhausted. Ask an administrator to configure a new range.`, 400);
  }

  return formatOrderCode(updated.seq);
}

const SALES_ORDER_SEQUENCE_NAME = 'salesOrderCode';
const PURCHASE_ORDER_SEQUENCE_NAME = 'purchaseOrderCode';
// The new, separate pre-invoice "Purchase Order" document (models/vendor/requisitionModel.js -
// internally named Requisition to avoid colliding with the existing PurchaseOrder/Invoice model,
// see that file's header comment) gets its own independent sequence - never shares a counter with
// the Invoice codes above.
const REQUISITION_SEQUENCE_NAME = 'requisitionCode';
// 12-digit codes - keep the same practical range the old countDocuments()+1 implementation could
// reach (well under 10^12), just atomic now.
const RANGE_MIN = 1;
const RANGE_MAX = 999999999999;

async function getNextSalesOrderCode(session) {
  return getNextOrderNumber(SALES_ORDER_SEQUENCE_NAME, RANGE_MIN, RANGE_MAX, session);
}

async function getNextPurchaseOrderCode(session) {
  return getNextOrderNumber(PURCHASE_ORDER_SEQUENCE_NAME, RANGE_MIN, RANGE_MAX, session);
}

async function getNextRequisitionCode(session) {
  return getNextOrderNumber(REQUISITION_SEQUENCE_NAME, RANGE_MIN, RANGE_MAX, session);
}

module.exports = {
  getNextSalesOrderCode,
  getNextPurchaseOrderCode,
  getNextRequisitionCode,
  formatOrderCode,
  SALES_ORDER_SEQUENCE_NAME,
  PURCHASE_ORDER_SEQUENCE_NAME,
  REQUISITION_SEQUENCE_NAME,
};
