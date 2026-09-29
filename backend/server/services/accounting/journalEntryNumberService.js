const Counter = require('../../models/config/counterModel');
const ApiError = require('../../utils/apiError');

const SEQUENCE_NAME = 'journalEntryNumber';

// Mirrors customerNumberService.js's atomic counter pattern (see docs/entities/customers.md) -
// deliberately NOT the older `countDocuments() + 1` pattern (utils/helper.js), which is race-prone
// under concurrent creates. See counterModel.js's comment for why.
const RANGE_MIN = parseInt(process.env.JOURNAL_ENTRY_NUMBER_RANGE_START, 10) || 100000;
const RANGE_MAX = parseInt(process.env.JOURNAL_ENTRY_NUMBER_RANGE_END, 10) || 999999999;

/**
 * Atomically allocates the next journal entry number. Must be called within the same
 * session/transaction that creates the JournalEntry document when used from an automatic
 * accounting flow (e.g. project creation), so a rolled-back journal entry does not "burn" a
 * number permanently - burning a number on abort is harmless (numbers need not be gap-free, only
 * unique and monotonic), but keeping the allocation inside the transaction avoids the entry
 * existing without ever having been assigned a durable number.
 */
async function getNextJournalEntryNumber(session) {
  try {
    await Counter.create([{ _id: SEQUENCE_NAME, seq: RANGE_MIN - 1, min: RANGE_MIN, max: RANGE_MAX }], { session });
  } catch (err) {
    if (err.code !== 11000) throw err;
  }

  const updated = await Counter.findOneAndUpdate(
    { _id: SEQUENCE_NAME, $expr: { $lt: ['$seq', '$max'] } },
    { $inc: { seq: 1 } },
    { new: true, session }
  );

  if (!updated) {
    const counter = await Counter.findById(SEQUENCE_NAME).session(session || null);
    const range = counter ? `${counter.min}-${counter.max}` : `${RANGE_MIN}-${RANGE_MAX}`;
    throw new ApiError(`Journal entry number range (${range}) is exhausted. Ask an administrator to configure a new range.`, 400);
  }

  return updated.seq;
}

module.exports = { getNextJournalEntryNumber, SEQUENCE_NAME, RANGE_MIN, RANGE_MAX };
