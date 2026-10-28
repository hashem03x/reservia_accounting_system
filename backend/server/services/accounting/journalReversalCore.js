const JournalEntry = require('../../models/accounting/journalEntryModel');
const ApiError = require('../../utils/apiError');
const { getNextJournalEntryNumber } = require('./journalEntryNumberService');
const { applyEntryProjectToLines } = require('./journalEntryProjectService');

// The one way a posted journal entry is fully reversed - used by the Journal Entries "Reverse"
// action and by the reversal engine (services/accounting/reversalService.js) alike, so both always
// produce the same mirror entry. The original is never edited beyond being marked reversed: a new
// entry with every line's debit and credit swapped (same accounts, sub accounts, parties, projects
// and descriptions) is posted, and the two are linked both ways.

/**
 * Must run inside the caller's transaction. Re-reads the entry inside it, so two concurrent
 * reversals of the same entry cannot both succeed (the second sees `reversedByEntry` and fails).
 */
async function mirrorReverseEntry({ entryId, date, reference, reason, userId, session }) {
  const original = await JournalEntry.findById(entryId).session(session);
  if (!original) throw new ApiError('No journal entry found with that id', 404);
  if (original.status !== 'posted' || original.reversedByEntry) throw new ApiError(`Journal entry #${original.entryNumber} has already been reversed.`, 400);
  if (original.reversalOfEntry) throw new ApiError('A reversal entry cannot itself be reversed.', 400);

  const entryNumber = await getNextJournalEntryNumber(session);
  const description = `Reversal of entry #${original.entryNumber}${original.description ? ` - ${original.description}` : ''}${reason ? ` (${reason})` : ''}`;
  const [reversal] = await JournalEntry.create(
    [
      {
        entryNumber,
        date,
        description: description.slice(0, 1000),
        reference,
        project: original.project,
        // Mirrors the original exactly, including null for an entry that predates the field.
        classification: original.classification ?? null,
        source: original.source,
        module: original.module,
        sourceType: null,
        sourceId: null,
        status: 'posted',
        // Lines mirror the original with debit/credit swapped. A project-related original's lines
        // all get the entry's Project and its real Project Number - this also completes a historical
        // original whose lines were posted without them, so reversing it never fails. A historical
        // line that named a different project keeps it (a reversal must mirror the original exactly).
        lines: await applyEntryProjectToLines({
          project: original.project,
          session,
          allowLineProjectOverride: true,
          lines: original.lines.map(line => ({
            account: line.account._id || line.account,
            subAccount: line.subAccount?._id || line.subAccount || null,
            partyNumber: line.partyNumber ?? null,
            partyType: line.partyType ?? null,
            project: line.project?._id || line.project || null,
            projectNumber: line.projectNumber,
            debit: line.credit,
            credit: line.debit,
<<<<<<< HEAD
            // Currency Management: a reversal mirrors the original line's currency/rate verbatim,
            // with transactionDebit/transactionCredit swapped the same way debit/credit are above
            // (a line that WAS a transaction debit becomes a transaction credit in the mirror) -
            // otherwise reversing a foreign-currency entry would silently lose its currency
            // annotation even though the EGP debit/credit themselves are already correctly swapped.
            currency: line.currency ?? null,
            exchangeRate: line.exchangeRate ?? null,
            transactionDebit: line.transactionCredit ?? null,
            transactionCredit: line.transactionDebit ?? null,
=======
            // The original's currency, rate and transaction-currency amounts are mirrored too, so
            // the reversal shows the same foreign amounts (swapped) at the SAME applied rate - a
            // reversal never re-prices an entry at a newer rate.
            currency: line.currency ?? null,
            exchangeRate: line.exchangeRate ?? null,
            currencyDebit: line.currencyCredit ?? null,
            currencyCredit: line.currencyDebit ?? null,
>>>>>>> origin/main
            description: line.description,
            unearnedRevenue: 0,
          })),
        }),
        currency: original.currency || 'EGP',
        currencyUnitsPerBase: original.currencyUnitsPerBase || 1,
        reversalOfEntry: original._id,
        // A reversal belongs to the same Advanced Payment as the entry it reverses.
        advancedPayment: original.advancedPayment || null,
        createdBy: userId,
        postedBy: userId,
        postedAt: new Date(),
      },
    ],
    { session }
  );

  original.reversedByEntry = reversal._id;
  original.reversedBy = userId;
  original.reversedAt = new Date();
  original.status = 'reversed';
  await original.save({ session });
  return { original, reversal };
}

module.exports = { mirrorReverseEntry };
