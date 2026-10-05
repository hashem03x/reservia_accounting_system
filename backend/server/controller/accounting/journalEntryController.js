const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');
const factory = require('../handlersFactory');
const JournalEntry = require('../../models/accounting/journalEntryModel');
const ApiError = require('../../utils/apiError');
const apiResponse = require('../../utils/apiResponse');
const { getNextJournalEntryNumber } = require('../../services/accounting/journalEntryNumberService');
const { getGeneralLedgerLines } = require('../../services/accounting/generalLedgerService');
const { logAccountingEvent, logAccountingError } = require('../../utils/accountingLogger');

const createJournalEntry = asyncHandler(async (req, res) => {
  // `project` is guaranteed present and valid by createJournalEntryValidators (RULE 2) by the time
  // this handler runs - never silently defaulted to null here.
  const { date, description, reference, project, lines } = req.body;

  const entryNumber = await getNextJournalEntryNumber();
  // Manual journal entries always start as a draft - posting is a separate, explicit action
  // (POST /:id/post). Any `status` sent in the body is ignored. The balance check (RULE 1) is
  // enforced unconditionally for every status by the model's own pre('save') hook - drafts are not
  // exempt.
  const entry = await JournalEntry.create({
    entryNumber,
    date,
    description,
    reference,
    project,
    lines: (lines || []).map(line => ({ ...line, projectNumber: line.projectNumber || null })),
    source: 'manual',
    status: 'draft',
    createdBy: req.user._id,
  });

  logAccountingEvent('JOURNAL_ENTRY_CREATED', { journalEntryId: entry._id, entryNumber: entry.entryNumber, requestId: req.id });

  res.status(201).json(apiResponse('Journal entry created successfully', true, entry));
});

const getJournalEntries = factory.getAll(JournalEntry, 'JournalEntry');

const getJournalEntry = factory.getOne(JournalEntry);

const getJournalEntriesForProject = asyncHandler(async (req, res) => {
  const entries = await JournalEntry.find({ project: req.params.projectId }).sort({ date: 1, entryNumber: 1 });
  res.status(200).json(apiResponse('Project journal entries retrieved successfully', true, entries));
});

const updateJournalEntry = asyncHandler(async (req, res, next) => {
  const entry = await JournalEntry.findById(req.params.id);
  if (!entry) return next(new ApiError('No journal entry found with that id', 404));

  if (entry.status !== 'draft') {
    return next(new ApiError('Only draft journal entries can be edited. Posted entries require a reversal.', 400));
  }

  const { date, description, reference, project, lines } = req.body;
  if (date !== undefined) entry.date = date;
  if (description !== undefined) entry.description = description;
  if (reference !== undefined) entry.reference = reference;
  if (project !== undefined) entry.project = project || null;
  if (lines !== undefined) entry.lines = lines.map(line => ({ ...line, projectNumber: line.projectNumber || null }));

  await entry.save();
  res.status(200).json(apiResponse('Journal entry updated successfully', true, entry));
});

const postJournalEntry = asyncHandler(async (req, res, next) => {
  const entry = await JournalEntry.findById(req.params.id);
  if (!entry) return next(new ApiError('No journal entry found with that id', 404));

  if (entry.status !== 'draft') {
    return next(new ApiError('Only draft journal entries can be posted.', 400));
  }
  if (entry.lines.length < 2) {
    return next(new ApiError('A journal entry must have at least two lines to be posted.', 400));
  }
  if (Math.round(entry.totalDebit * 100) !== Math.round(entry.totalCredit * 100)) {
    return next(new ApiError('Journal entry cannot be posted because total debit does not equal total credit.', 400));
  }

  entry.status = 'posted';
  entry.postedBy = req.user._id;
  entry.postedAt = new Date();
  await entry.save();

  logAccountingEvent('JOURNAL_ENTRY_POSTED', { journalEntryId: entry._id, entryNumber: entry.entryNumber, requestId: req.id });

  res.status(200).json(apiResponse('Journal entry posted successfully', true, entry));
});

// Posted accounting records are never edited or hard-deleted (see reversia master spec's
// "Journal Entry Posting" + "Accounting Safety" sections). A reversal is a new, fully-posted
// entry with every line's debit/credit swapped relative to the original, linked both ways so the
// UI can navigate from either entry to the other.
//
// The reversal entry's `date` is the admin-supplied `reversalDate` - NEVER today's date, the
// original entry's date, or the server clock. This is deliberate (confirmed requirement, not a
// default): a reversal posted today for an entry originally dated weeks ago may need to land on a
// specific accounting date (e.g. period-end), and silently defaulting it would get that wrong.
// `reverseJournalEntryValidators` (utils/validators/journalEntryValidators.js) rejects the request
// before this handler ever runs if `reversalDate` is missing or not a valid date.
const reverseJournalEntry = asyncHandler(async (req, res, next) => {
  const original = await JournalEntry.findById(req.params.id);
  if (!original) return next(new ApiError('No journal entry found with that id', 404));

  // Cheap pre-check outside any transaction - fails fast for the ordinary case (nothing racing)
  // without paying for a session/transaction on an obviously-invalid request. This is NOT the
  // only check - see the re-check inside the transaction below, which is the one that actually
  // closes the race window between two concurrent reversal requests for the same entry.
  if (original.status !== 'posted') {
    return next(new ApiError('Only posted journal entries can be reversed.', 400));
  }
  if (original.reversedByEntry) {
    return next(new ApiError('This journal entry has already been reversed.', 400));
  }
  // A reversal entry is itself a valid posted entry (status 'posted', reversedByEntry null), so
  // without this check it would otherwise pass both guards above and could be reversed again,
  // chaining indefinitely (Original -> Reversal -> Reversal of Reversal -> ...). `reversalOfEntry`
  // is only ever set on a reversal entry, so this cleanly identifies and blocks that case without
  // affecting a normal original entry.
  if (original.reversalOfEntry) {
    return next(new ApiError('A reversal entry cannot itself be reversed.', 400));
  }

  const { reversalDate, reference } = req.body;
  const startedAt = Date.now();

  const session = await mongoose.startSession();
  try {
    let reversal;
    await session.withTransaction(async () => {
      // Re-fetch INSIDE the transaction's own snapshot and re-check - the pre-check above has a
      // window between two concurrent requests for the same entry (both could read "not reversed
      // yet" before either writes). Whichever request's transaction commits first wins; the loser
      // sees `reversedByEntry` already set here and fails cleanly with a normal business error
      // instead of racing to create two reversal entries for the same original.
      const currentOriginal = await JournalEntry.findById(original._id).session(session);
      if (!currentOriginal || currentOriginal.status !== 'posted' || currentOriginal.reversedByEntry) {
        throw new ApiError('This journal entry has already been reversed.', 400);
      }
      if (currentOriginal.reversalOfEntry) {
        throw new ApiError('A reversal entry cannot itself be reversed.', 400);
      }

      const entryNumber = await getNextJournalEntryNumber(session);

      const [created] = await JournalEntry.create(
        [
          {
            entryNumber,
            date: reversalDate,
            description: `Reversal of entry #${currentOriginal.entryNumber}${currentOriginal.description ? ` - ${currentOriginal.description}` : ''}`,
            reference,
            project: currentOriginal.project,
            source: currentOriginal.source,
            module: currentOriginal.module,
            sourceType: null,
            sourceId: null,
            status: 'posted',
            lines: currentOriginal.lines.map(line => ({
              account: line.account._id || line.account,
              subAccount: line.subAccount?._id || line.subAccount || null,
              partyNumber: line.partyNumber ?? null,
              partyType: line.partyType ?? null,
              project: line.project?._id || line.project || null,
              projectNumber: line.projectNumber,
              debit: line.credit,
              credit: line.debit,
              description: line.description,
              unearnedRevenue: 0,
            })),
            reversalOfEntry: currentOriginal._id,
            createdBy: req.user._id,
            postedBy: req.user._id,
            postedAt: new Date(),
          },
        ],
        { session }
      );
      reversal = created;

      currentOriginal.reversedByEntry = reversal._id;
      currentOriginal.reversedBy = req.user._id;
      currentOriginal.reversedAt = new Date();
      currentOriginal.status = 'reversed';
      await currentOriginal.save({ session });
    });

    logAccountingEvent('JOURNAL_ENTRY_REVERSED', {
      journalEntryId: original._id,
      entryNumber: original.entryNumber,
      reversalEntryId: reversal._id,
      reversalEntryNumber: reversal.entryNumber,
      durationMs: Date.now() - startedAt,
      requestId: req.id,
    });

    res.status(201).json(apiResponse('Journal entry reversed successfully', true, reversal));
  } catch (err) {
    // Enough to diagnose a transaction failure (operation, which entry, how long it ran, the
    // Mongo error's own code/name/labels) without ever logging connection strings, credentials,
    // or request bodies.
    logAccountingError('JOURNAL_ENTRY_REVERSAL_FAILED', err, {
      journalEntryId: original._id,
      entryNumber: original.entryNumber,
      durationMs: Date.now() - startedAt,
      mongoErrorCode: err.code,
      mongoErrorLabels: typeof err.errorLabels === 'function' ? err.errorLabels() : err.errorLabels,
      requestId: req.id,
    });
    throw err;
  } finally {
    session.endSession();
  }
});

// GET /journal-entries/general-ledger - the flattened, one-row-per-line view (docs section
// "Journal Entries / General Ledger table") - response shape deliberately mirrors
// handlersFactory.js#getAll exactly (`results`/`paginationResult`/`data`) so the existing
// PaginationHandler/PaginatedData<T> frontend plumbing works unmodified.
const getGeneralLedger = asyncHandler(async (req, res) => {
  const { page, limit } = req.query;
  const result = await getGeneralLedgerLines({ page, limit });
  res.status(200).json(result);
});

module.exports = {
  createJournalEntry,
  getJournalEntries,
  getJournalEntry,
  getJournalEntriesForProject,
  updateJournalEntry,
  postJournalEntry,
  reverseJournalEntry,
  getGeneralLedger,
};
