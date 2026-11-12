const Counter = require('../../models/config/counterModel');
const ApiError = require('../../utils/apiError');

// Reservia Commercial - project code generation. Mirrors
// services/project/projectNumberService.js's atomic counter pattern exactly (same Counter
// collection, same fast-path-then-seed-then-retry shape), parameterized by category instead of
// sector: format is `<CATEGORY_PREFIX>-<6-digit seq>`, one independent sequence per category so
// "On-Grid" and "Agriculture Pumping" projects are numbered in their own counters.
const CATEGORY_PREFIXES = {
  'On-Grid C&I': 'ONG',
  'Off-Grid': 'OFG',
  'Agriculture Pumping': 'PMP',
  'Utility Scale': 'UTL',
  'Street Lighting': 'STL',
  'Solar Water Heating': 'SWH',
};

const RANGE_MIN = 1;
const RANGE_MAX = 999999;

function sequenceNameFor(prefix) {
  return `commercialProjectCode:${prefix}`;
}

function formatProjectCode(prefix, seq) {
  return `${prefix}-${String(seq).padStart(6, '0')}`;
}

async function getNextProjectCode(category, session) {
  const prefix = CATEGORY_PREFIXES[category];
  if (!prefix) throw new ApiError(`Unknown Deal Engine project category: "${category}"`, 400);
  const sequenceName = sequenceNameFor(prefix);

  let updated = await Counter.findOneAndUpdate(
    { _id: sequenceName, $expr: { $lt: ['$seq', '$max'] } },
    { $inc: { seq: 1 } },
    { new: true, session }
  );

  if (!updated) {
    try {
      await Counter.create([{ _id: sequenceName, seq: RANGE_MIN - 1, min: RANGE_MIN, max: RANGE_MAX }], { session });
    } catch (err) {
      if (err.code !== 11000) throw err;
    }
    updated = await Counter.findOneAndUpdate(
      { _id: sequenceName, $expr: { $lt: ['$seq', '$max'] } },
      { $inc: { seq: 1 } },
      { new: true, session }
    );
  }

  if (!updated) {
    throw new ApiError(`Deal Engine project code range for "${category}" is exhausted. Ask an administrator to configure a new range.`, 400);
  }

  return formatProjectCode(prefix, updated.seq);
}

module.exports = { getNextProjectCode, CATEGORY_PREFIXES, formatProjectCode };
