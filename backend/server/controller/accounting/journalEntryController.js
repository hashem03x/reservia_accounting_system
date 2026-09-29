const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');
const factory = require('../handlersFactory');
const JournalEntry = require('../../models/accounting/journalEntryModel');
const ApiError = require('../../utils/apiError');
const apiResponse = require('../../utils/apiResponse');
const { getNextJournalEntryNumber } = require('../../services/accounting/journalEntryNumberService');
const { logAccountingEvent } = require('../../utils/accountingLogger');

const createJournalEntry = asyncHandler(async (req, res) => {
  const { date, description, reference, project, lines } = req.body;

  const entryNumber = await getNextJournalEntryNumber();
  // Manual journal entries always start as a draft - posting (and the balance check that gates
  // it) is a separate, explicit action (POST /:id/post). Any `status` sent in the body is ignored.
  const entry = await JournalEntry.create({
    entryNumber,
    date,
    description,
    reference,
    project: project || null,
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
const reverseJournalEntry = asyncHandler(async (req, res, next) => {
  const original = await JournalEntry.findById(req.params.id);
  if (!original) return next(new ApiError('No journal entry found with that id', 404));

  if (original.status !== 'posted') {
    return next(new ApiError('Only posted journal entries can be reversed.', 400));
  }
  if (original.reversedByEntry) {
    return next(new ApiError('This journal entry has already been reversed.', 400));
  }

  const session = await mongoose.startSession();
  try {
    let reversal;
    await session.withTransaction(async () => {
      const entryNumber = await getNextJournalEntryNumber(session);

      const [created] = await JournalEntry.create(
        [
          {
            entryNumber,
            date: new Date(),
            description: `Reversal of entry #${original.entryNumber}${original.description ? ` - ${original.description}` : ''}`,
            reference: req.body.reference,
            project: original.project,
            source: original.source,
            sourceType: null,
            sourceId: null,
            status: 'posted',
            lines: original.lines.map(line => ({
              account: line.account._id || line.account,
              subAccount: line.subAccount?._id || line.subAccount || null,
              project: line.project?._id || line.project || null,
              projectNumber: line.projectNumber,
              debit: line.credit,
              credit: line.debit,
              description: line.description,
              unearnedRevenue: 0,
            })),
            reversalOfEntry: original._id,
            createdBy: req.user._id,
            postedBy: req.user._id,
            postedAt: new Date(),
          },
        ],
        { session }
      );
      reversal = created;

      original.reversedByEntry = reversal._id;
      original.reversedBy = req.user._id;
      original.reversedAt = new Date();
      original.status = 'reversed';
      await original.save({ session });
    });

    logAccountingEvent('JOURNAL_ENTRY_REVERSED', { journalEntryId: original._id, reversalEntryId: reversal._id, requestId: req.id });

    res.status(201).json(apiResponse('Journal entry reversed successfully', true, reversal));
  } finally {
    session.endSession();
  }
});

module.exports = {
  createJournalEntry,
  getJournalEntries,
  getJournalEntry,
  getJournalEntriesForProject,
  updateJournalEntry,
  postJournalEntry,
  reverseJournalEntry,
};
