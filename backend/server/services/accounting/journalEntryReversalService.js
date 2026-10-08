const JournalEntry = require('../../models/accounting/journalEntryModel');
const ApiError = require('../../utils/apiError');
const { getNextJournalEntryNumber } = require('./journalEntryNumberService');
const { applyEntryProjectToLines } = require('./journalEntryProjectService');

/**
 * Reverses one posted journal entry: a new, fully-posted entry with every line's debit/credit
 * swapped, linked both ways, and the original marked 'reversed'. The one reversal implementation,
 * used by the admin "Reverse" action (journalEntryController.js#reverseJournalEntry) and by the
 * automatic accounting engine when a recognition must be taken back (Sales Order Cost Recognition).
 *
 * Must run inside the caller's transaction `session`: the original is re-read there and re-checked,
 * so two concurrent reversals of the same entry cannot both succeed - the loser fails with a normal
 * business error. A reversal entry can never itself be reversed.
 */
async function createReversalEntry(originalId, { reversalDate, reference, userId = null, description }, session) {
  const currentOriginal = await JournalEntry.findById(originalId).session(session || null);
  if (!currentOriginal || currentOriginal.status !== 'posted' || currentOriginal.reversedByEntry) {
    throw new ApiError('This journal entry has already been reversed.', 400);
  }
  if (currentOriginal.reversalOfEntry) {
    throw new ApiError('A reversal entry cannot itself be reversed.', 400);
  }

  const entryNumber = await getNextJournalEntryNumber(session);
  const [reversal] = await JournalEntry.create(
    [
      {
        entryNumber,
        date: reversalDate,
        description: description || `Reversal of entry #${currentOriginal.entryNumber}${currentOriginal.description ? ` - ${currentOriginal.description}` : ''}`,
        reference,
        project: currentOriginal.project,
        source: currentOriginal.source,
        module: currentOriginal.module,
        sourceType: null,
        sourceId: null,
        status: 'posted',
        // Lines mirror the original with debit/credit swapped. A project-related original's lines
        // all get the entry's Project and its real Project Number - this also completes a
        // historical original whose lines were posted without them, so reversing it never fails. A
        // historical line that named a different project keeps it (a reversal must mirror the
        // original exactly).
        lines: await applyEntryProjectToLines({
          project: currentOriginal.project,
          session,
          allowLineProjectOverride: true,
          lines: currentOriginal.lines.map(line => ({
            account: line.account._id || line.account,
            subAccount: line.subAccount?._id || line.subAccount || null,
            partyNumber: line.partyNumber ?? null,
            partyType: line.partyType ?? null,
            project: line.project?._id || line.project || null,
            projectNumber: line.projectNumber,
            debit: line.credit,
            credit: line.debit,
            unearnedRevenue: 0,
          })),
        }),
        reversalOfEntry: currentOriginal._id,
        // A reversal belongs to the same Advanced Payment / Sales Order as the entry it reverses.
        advancedPayment: currentOriginal.advancedPayment || null,
        triggeredBySalesOrder: currentOriginal.triggeredBySalesOrder?._id || currentOriginal.triggeredBySalesOrder || null,
        createdBy: userId,
        postedBy: userId,
        postedAt: new Date(),
      },
    ],
    { session }
  );

  currentOriginal.reversedByEntry = reversal._id;
  currentOriginal.reversedBy = userId;
  currentOriginal.reversedAt = new Date();
  currentOriginal.status = 'reversed';
  await currentOriginal.save({ session });
  return reversal;
}

module.exports = { createReversalEntry };
