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
 *
 * FAST PATH FIRST, ON PURPOSE: an earlier version of this function unconditionally attempted
 * `Counter.create(...)` (to seed the counter) before every single increment. That is safe when
 * called outside a transaction (a duplicate-key error is just caught and ignored), but once the
 * counter document exists - true after the very first journal entry ever allocated in the
 * system's lifetime - that create() is guaranteed to hit a duplicate-key error on every
 * subsequent call. Inside an active multi-document transaction (both reverseJournalEntry and
 * createProject call this with a session), a failed write is not something you can just catch and
 * continue past: MongoDB marks the ENTIRE transaction unusable server-side the moment any write
 * in it fails, even if the driver error is caught in application code. The very next operation
 * (the actual increment) then failed against that now-broken transaction with a
 * TransientTransactionError, which mongoose's session.withTransaction() automatically retries -
 * by re-running this exact same doomed sequence. The result was an infinite-until-timeout retry
 * loop (visible as a climbing MongoDB txnNumber) that eventually surfaced as "Transaction with {
 * txnNumber: N } has been aborted" - this was the actual root cause of the slow/failing journal
 * entry reversals (and equally affected project creation and fixed-asset purchases with a linked
 * journal entry, since all three call this same function).
 *
 * The fix: attempt the atomic increment FIRST. In the overwhelmingly common case (counter already
 * exists), that is the only database write this function ever performs, so there is no possible
 * duplicate-key write to poison the caller's transaction. Seeding is only attempted on the slow
 * path (counter genuinely doesn't exist yet - this sequence's very first allocation ever).
 *
 * The seed write MUST use the caller's `session` when one is given - an earlier version of this
 * fix seeded without it (reasoning: seeding is one-time infrastructure setup, so it doesn't need
 * to share the caller's atomicity), which introduced a DIFFERENT bug: when called from inside an
 * active transaction, a write made without that transaction's session is invisible to reads made
 * WITH it (snapshot isolation) - so the very next line, the in-transaction `findOneAndUpdate`,
 * could never see the document it had just (out-of-band) created, and every first-ever allocation
 * made from inside a transaction failed as "range exhausted" (verified against a real replica set
 * while fixing this). Using the session for the seed write means it's part of the same
 * transaction, so the subsequent read-your-own-write increment sees it correctly. The remaining
 * risk - two concurrent transactions both seeding for the true first-ever allocation - is rare
 * (happens at most once in the system's lifetime) and self-heals: the loser's `create()` fails
 * with a duplicate-key error inside its transaction, which aborts that transaction and triggers
 * `session.withTransaction()`'s built-in retry; the retry's fresh read sees the winner's
 * already-committed document and takes the fast path directly - one extra round-trip, not a loop.
 */
async function getNextJournalEntryNumber(session) {
  let updated = await Counter.findOneAndUpdate(
    { _id: SEQUENCE_NAME, $expr: { $lt: ['$seq', '$max'] } },
    { $inc: { seq: 1 } },
    { new: true, session }
  );

  if (!updated) {
    const existing = await Counter.findById(SEQUENCE_NAME).session(session || null);
    if (!existing) {
      try {
        await Counter.create([{ _id: SEQUENCE_NAME, seq: RANGE_MIN - 1, min: RANGE_MIN, max: RANGE_MAX }], { session });
      } catch (err) {
        if (err.code !== 11000) throw err; // lost the seed race to a concurrent first-ever caller - fine
      }
      updated = await Counter.findOneAndUpdate(
        { _id: SEQUENCE_NAME, $expr: { $lt: ['$seq', '$max'] } },
        { $inc: { seq: 1 } },
        { new: true, session }
      );
    }
  }

  if (!updated) {
    const counter = await Counter.findById(SEQUENCE_NAME).session(session || null);
    const range = counter ? `${counter.min}-${counter.max}` : `${RANGE_MIN}-${RANGE_MAX}`;
    throw new ApiError(`Journal entry number range (${range}) is exhausted. Ask an administrator to configure a new range.`, 400);
  }

  return updated.seq;
}

module.exports = { getNextJournalEntryNumber, SEQUENCE_NAME, RANGE_MIN, RANGE_MAX };
