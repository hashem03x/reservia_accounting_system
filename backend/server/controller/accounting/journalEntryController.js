const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');
const factory = require('../handlersFactory');
const JournalEntry = require('../../models/accounting/journalEntryModel');
const ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
const Project = require('../../models/project/projectModel');
const ApiError = require('../../utils/apiError');
const apiResponse = require('../../utils/apiResponse');
const { getNextJournalEntryNumber } = require('../../services/accounting/journalEntryNumberService');
const { getGeneralLedgerLines, resolveSubAccountsForEntries } = require('../../services/accounting/generalLedgerService');
const { applyEntryProjectToLines } = require('../../services/accounting/journalEntryProjectService');
const { mirrorReverseEntry } = require('../../services/accounting/journalReversalCore');
const { lineRules } = require('../../services/accounting/journalLinePartyService');
const { logAccountingEvent, logAccountingError } = require('../../utils/accountingLogger');
const { resolveEntryCurrency } = require('../../services/accounting/currencyService');
const { applyCurrencyToLines, storedLinesAsInput } = require('../../services/accounting/journalEntryCurrencyService');

const createJournalEntry = asyncHandler(async (req, res) => {
  // `project` is guaranteed either present-and-valid, or absent-and-the-user-is-authorized for a
  // "General" entry (journalEntries:createGeneral) by createJournalEntryValidators (RULE 2) by the
  // time this handler runs - never silently defaulted to null here.
  const { date, description, reference, project, lines, currency, exchangeRate } = req.body;

  // Transaction currency + applied rate, resolved and validated server-side (an omitted rate gets
  // the currency's rate effective on the entry date). Line amounts in the request are in that
  // currency and are converted to EGP here - see journalEntryCurrencyService.js.
  const entryCurrency = await resolveEntryCurrency({ currency, exchangeRate, date: date || new Date() });
  const convertedLines = applyCurrencyToLines(lines || [], entryCurrency);

  const entryNumber = await getNextJournalEntryNumber();
  // Manual journal entries always start as a draft - posting is a separate, explicit action
  // (POST /:id/post). Any `status` sent in the body is ignored. The balance check (RULE 1) is
  // enforced unconditionally for every status by the model's own pre('save') hook - drafts are not
  // exempt.
  const entry = new JournalEntry({
    entryNumber,
    date,
    description,
    reference,
    project,
    // Every line gets the entry's Project and that Project's real Project Number (a client-typed
    // projectNumber is never trusted) - see journalEntryProjectService.js.
    lines: await applyEntryProjectToLines({ project, lines: convertedLines }),
    currency: entryCurrency.code,
    currencyUnitsPerBase: entryCurrency.unitsPerBase,
    source: 'manual',
    status: 'draft',
    createdBy: req.user._id,
  });
  // Journal Entry Project / General selection: the validator already verified the user holds
  // journalEntries:createGeneral when `project` is absent - signal that to the model's own
  // backstop (journalEntryModel.js) via $locals, never persisted, never settable from the request
  // body itself.
  if (!project) entry.$locals.generalEntryAuthorized = true;
  await entry.save();

  logAccountingEvent('JOURNAL_ENTRY_CREATED', { journalEntryId: entry._id, entryNumber: entry.entryNumber, requestId: req.id });

  res.status(201).json(apiResponse('Journal entry created successfully', true, entry));
});

// Labels each entry row with currency/rate/difference derived purely from its own already-
// populated `lines[]` - zero extra queries (docs section "Which balance should the main page
// show?"). `difference` is the JE-level Total Debit - Total Credit (0 for a valid/balanced entry) -
// NEVER a per-account running balance, which is a different concept shown only on the General
// Ledger view (services/accounting/generalLedgerService.js). `currency`/`rate` are read off the
// first line that actually carries them (most entries are single-currency; a manual entry with no
// currency recorded falls back to null so the frontend can show the local-currency default).
//
// Currency Manager: an entry recorded in a foreign transaction currency (entry.currency !== EGP)
// reports that currency and its APPLIED rate. `rate` keeps its existing meaning - EGP per 1 unit
// of the currency (the import convention) - i.e. 1 / currencyUnitsPerBase for such an entry.
function withEntryListFields(entries) {
  return entries.map(entry => {
    const withCurrency = entry.lines.find(line => line.currency);
    const plain = typeof entry.toObject === 'function' ? entry.toObject() : entry;
    const foreignEntry = entry.currency && entry.currency !== 'EGP';
    return {
      ...plain,
      currency: foreignEntry ? entry.currency : withCurrency?.currency || null,
      rate: foreignEntry ? 1 / entry.currencyUnitsPerBase : withCurrency?.exchangeRate || null,
      difference: Math.round(((entry.totalDebit || 0) - (entry.totalCredit || 0)) * 100) / 100,
    };
  });
}

const listJournalEntries = factory.getAll(JournalEntry, 'JournalEntry', ' ', false, withEntryListFields);

// Journal entries are listed by Entry Number, ascending (numeric - entryNumber is a Number), unless
// the caller asks for another order. Entry numbers are unique, so the order is stable across pages
// and filters.
//
// Only these fields may be sorted on - apiFeatures.sort() otherwise passes `req.query.sort`
// straight into Mongoose's `.sort()` with no validation at all (any client-supplied field name is
// accepted as-is), which is unsafe and can silently sort by a meaningless/non-indexed field. An
// unlisted/unknown field falls back to the default rather than erroring - this is a list view, not
// a page that should break over a bad query param.
const SORTABLE_FIELDS = ['entryNumber', 'date', 'totalDebit', 'totalCredit'];
function sanitizeSort(rawSort) {
  if (!rawSort) return 'entryNumber';
  const fields = rawSort
    .split(',')
    .map(f => f.trim())
    .filter(f => SORTABLE_FIELDS.includes(f.startsWith('-') ? f.slice(1) : f));
  return fields.length > 0 ? fields.join(',') : 'entryNumber';
}

// Builds `req.filterObject` from named, whitelisted query params - the same
// "resolve human-readable filters into a safe Mongo filter object, then delete the raw query
// params" convention already used by productController.js#createFilterObject. Deleting each
// consumed param from `req.query` is required, not cosmetic: apiFeatures.filter() merges
// `req.query` straight into the Mongo filter with no field whitelist of its own, so leaving e.g.
// `dateFrom` in `req.query` would add a literal `{ dateFrom: '...' }` clause that matches zero
// documents (no document has a field by that name) and silently empties every result.
const createJournalEntryFilterObject = asyncHandler(async (req, res, next) => {
  const filter = {};
  const { entryNumber, dateFrom, dateTo, accountNumber, accountName, subAccount, projectNumber, description, debitMin, debitMax, creditMin, creditMax, status, isReversal } = req.query;

  if (entryNumber) {
    filter.entryNumber = Number(entryNumber);
    delete req.query.entryNumber;
  }

  if (dateFrom || dateTo) {
    filter.date = {};
    if (dateFrom) filter.date.$gte = new Date(dateFrom);
    if (dateTo) filter.date.$lte = new Date(dateTo);
    delete req.query.dateFrom;
    delete req.query.dateTo;
  }

  if (accountNumber) {
    const account = await ChartOfAccount.findOne({ code: accountNumber }).select('_id');
    // An unknown account number must return zero rows, not every row (omitting the filter would).
    filter['lines.account'] = account ? account._id : null;
    delete req.query.accountNumber;
  }

  if (accountName) {
    const accounts = await ChartOfAccount.find({ name: { $regex: accountName, $options: 'i' } }).select('_id');
    filter['lines.account'] = { $in: accounts.map(a => a._id) };
    delete req.query.accountName;
  }

  if (subAccount) {
    filter['lines.partyNumber'] = Number(subAccount);
    delete req.query.subAccount;
  }

  if (projectNumber) {
    if (['general', 'none', 'null'].includes(projectNumber.toLowerCase())) {
      filter.project = null;
    } else {
      const project = await Project.findOne({ projectNumber }).select('_id');
      filter.project = project ? project._id : null;
    }
    delete req.query.projectNumber;
  }

  if (description) {
    filter.description = { $regex: description, $options: 'i' };
    delete req.query.description;
  }

  if (debitMin || debitMax) {
    filter.totalDebit = {};
    if (debitMin) filter.totalDebit.$gte = Number(debitMin);
    if (debitMax) filter.totalDebit.$lte = Number(debitMax);
    delete req.query.debitMin;
    delete req.query.debitMax;
  }

  if (creditMin || creditMax) {
    filter.totalCredit = {};
    if (creditMin) filter.totalCredit.$gte = Number(creditMin);
    if (creditMax) filter.totalCredit.$lte = Number(creditMax);
    delete req.query.creditMin;
    delete req.query.creditMax;
  }

  if (status) {
    filter.status = status;
    delete req.query.status;
  }

  if (isReversal !== undefined) {
    filter.reversalOfEntry = isReversal === 'true' ? { $ne: null } : null;
    delete req.query.isReversal;
  }

  // Defense in depth: apiFeatures.filter() (utils/apiFeatures.js) merges whatever is left in
  // req.query straight into the Mongo filter with NO field whitelist of its own - any leftover,
  // unrecognized param (a typo, an old bookmarked URL, a stale frontend build) would add a
  // literal `{ thatParam: '...' }` clause that matches zero real documents (no JournalEntry has a
  // field by that name) and silently empties the entire list. Every param this endpoint actually
  // supports has already been deleted above; anything still present is not a real filter this
  // endpoint recognizes, so it is stripped here rather than passed through.
  const ALLOWED_PASSTHROUGH = ['limit', 'page', 'fields', 'sort', 'keyword', 'lang'];
  Object.keys(req.query).forEach(key => {
    if (!ALLOWED_PASSTHROUGH.includes(key)) delete req.query[key];
  });

  req.filterObject = filter;
  next();
});

const getJournalEntries = (req, res, next) => {
  req.query.sort = sanitizeSort(req.query.sort);
  return listJournalEntries(req, res, next);
};

// GET /journal-entries/line-rules - which accounts require a customer / vendor Sub Account.
const getJournalLineRules = asyncHandler(async (req, res) => {
  res.status(200).json(apiResponse('Journal line rules retrieved successfully', true, await lineRules()));
});

// Same `{ data }` shape as factory.getOne, plus `resolvedSubAccount`: the customer/vendor the entry
// belongs to, resolved from its source document - the Sub Account shown on any line that does not
// carry its own (entries created before every line was stamped with it). Null when the entry has
// no party (e.g. a manual entry).
const getJournalEntry = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) return next(new ApiError('Invalid journal entry id', 400));
  const entry = await JournalEntry.findById(id);
  if (!entry) return next(new ApiError(`No document for this id ${id}`, 404));

  const resolved = await resolveSubAccountsForEntries([entry]);
  res.status(200).json({ data: { ...entry.toJSON(), resolvedSubAccount: resolved.get(entry._id.toString()) || null } });
});

const getJournalEntriesForProject = asyncHandler(async (req, res) => {
  const entries = await JournalEntry.find({ project: req.params.projectId }).sort({ entryNumber: 1 });
  res.status(200).json(apiResponse('Project journal entries retrieved successfully', true, entries));
});

// GET /journal-entries/sales-order/:salesOrderId - every automatic Journal Entry genuinely linked
// to this Sales Order (docs section "Sales Order -> Automatic JE Display"). A single SO can
// legitimately produce several, via three distinct, backend-authoritative relationships - never a
// text/customer-name/Project-Number search:
//   1. Direct: sourceType 'SO' & sourceId = this order's _id (SO_CUSTOMER_ADVANCE_APPLIED,
//      SO_PAYMENT_RECORDED when posted straight off the order's own creation flow).
//   2. Via Payment: a later Add Payment against this order creates its own Payment document first
//      (sourceType 'PAYMENT', sourceId = that payment's _id) - found by one extra query on
//      Payment.salesOrderId, never by matching on amount/date/description.
//   3. triggeredBySalesOrder: PROJECT_REVENUE_RECOGNITION/PROJECT_COST_RECOGNITION entries, whose
//      real sourceId is a deterministic project+percentage hash (not this order's id) - this field
//      is the one reliable link back to the specific Sales Order that pushed the project's executed
//      percentage up (see projectAccountingService.js#recalculateExecutedPercentage).
// One request total besides the Payment lookup - acceptable on a single-entity detail page (docs
// section "Performance" - the N+1 constraint is about LIST pages, not this).
const getJournalEntriesForSalesOrder = asyncHandler(async (req, res) => {
  const Payment = require('../../models/vendor/paymentModel'); // eslint-disable-line global-require
  const { salesOrderId } = req.params;

  const payments = await Payment.find({ salesOrderId }).select('_id').lean();
  const paymentIds = payments.map(p => p._id);

  const entries = await JournalEntry.find({
    $or: [
      { sourceType: 'SO', sourceId: salesOrderId },
      { sourceType: 'PAYMENT', sourceId: { $in: paymentIds } },
      { triggeredBySalesOrder: salesOrderId },
    ],
  }).sort({ entryNumber: 1 });

  res.status(200).json(apiResponse('Sales invoice journal entries retrieved successfully', true, entries));
});

// GET /journal-entries/purchase-order/:purchaseOrderId - mirrors getJournalEntriesForSalesOrder
// above for the vendor side. No PROJECT-hash equivalent exists on the Purchase Order side (there is
// no PO-triggered project recognition flow), so only the direct + via-Payment relationships apply.
const getJournalEntriesForPurchaseOrder = asyncHandler(async (req, res) => {
  const Payment = require('../../models/vendor/paymentModel'); // eslint-disable-line global-require
  const { purchaseOrderId } = req.params;

  const payments = await Payment.find({ purchaseOrderId }).select('_id').lean();
  const paymentIds = payments.map(p => p._id);

  const entries = await JournalEntry.find({
    $or: [
      { sourceType: 'PO', sourceId: purchaseOrderId },
      { sourceType: 'PAYMENT', sourceId: { $in: paymentIds } },
    ],
  }).sort({ entryNumber: 1 });

  res.status(200).json(apiResponse('Purchase invoice journal entries retrieved successfully', true, entries));
});

// GET /journal-entries/advanced-payment/:advancedPaymentId - every Journal Entry that belongs to
// this Advanced Payment, via persisted references only (never a text/description/amount match):
//   1. `advancedPayment` - stamped by the automatic accounting engine on the advance's own creation
//      entry and on every entry that consumed it (see accountingEventService.js).
//   2. Entries posted before that field existed, found through their own source keys: the advance's
//      creation entry (sourceType 'ADVANCED_PAYMENT', sourceId = this advance), and the
//      "advance applied" entries of the exact Sales Orders / Purchase Orders / Payments recorded in
//      this advance's usageHistory.
//   3. Reversal entries of any of the above (reversalOfEntry), so a reversed posting never
//      silently disappears from the advance's history.
const getJournalEntriesForAdvancedPayment = asyncHandler(async (req, res, next) => {
  const AdvancedPayment = require('../../models/payments/advancedPaymentModel'); // eslint-disable-line global-require
  const { advancedPaymentId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(advancedPaymentId)) return next(new ApiError('Invalid advanced payment id', 400));

  const advance = await AdvancedPayment.findById(advancedPaymentId).select('usageHistory').lean();
  if (!advance) return next(new ApiError('No advanced payment found with that id', 404));

  // Raw-collection query below (no Mongoose casting), so ids are converted to real ObjectIds here.
  const idsOf = key =>
    [...new Set((advance.usageHistory || []).map(u => (u?.[key]?._id || u?.[key])?.toString()).filter(Boolean))].map(id => new mongoose.Types.ObjectId(id));
  const salesOrderIds = idsOf('salesOrder');
  const purchaseOrderIds = idsOf('purchaseOrder');
  const paymentIds = idsOf('payment');

  const linkConditions = [{ advancedPayment: advance._id }, { sourceType: 'ADVANCED_PAYMENT', sourceId: advance._id }];
  if (salesOrderIds.length) linkConditions.push({ sourceType: 'SO', sourceId: { $in: salesOrderIds }, accountingAction: 'SO_CUSTOMER_ADVANCE_APPLIED' });
  if (purchaseOrderIds.length) linkConditions.push({ sourceType: 'PO', sourceId: { $in: purchaseOrderIds }, accountingAction: 'PO_SUPPLIER_ADVANCE_APPLIED' });
  if (paymentIds.length) {
    linkConditions.push({ sourceType: 'PAYMENT', sourceId: { $in: paymentIds }, accountingAction: { $in: ['PAYMENT_CUSTOMER_ADVANCE_APPLIED', 'PAYMENT_VENDOR_ADVANCE_APPLIED'] } });
  }

  const linked = await JournalEntry.collection.find({ $or: linkConditions }, { projection: { _id: 1 } }).toArray();
  const linkedIds = linked.map(e => e._id);

  const entries = linkedIds.length
    ? await JournalEntry.find({ $or: [{ _id: { $in: linkedIds } }, { reversalOfEntry: { $in: linkedIds } }] }).sort({ entryNumber: 1 })
    : [];

  res.status(200).json(apiResponse('Advanced payment journal entries retrieved successfully', true, entries));
});

const updateJournalEntry = asyncHandler(async (req, res, next) => {
  const entry = await JournalEntry.findById(req.params.id);
  if (!entry) return next(new ApiError('No journal entry found with that id', 404));

  if (entry.status !== 'draft') {
    return next(new ApiError('Only draft journal entries can be edited. Posted entries require a reversal.', 400));
  }

  const { date, description, reference, project, lines, currency, exchangeRate } = req.body;
  if (date !== undefined) entry.date = date;
  if (description !== undefined) entry.description = description;
  if (reference !== undefined) entry.reference = reference;
  if (project !== undefined) entry.project = project || null;

  // Currency: re-resolved (and the lines re-converted) when the currency, rate or lines change. The
  // entry's own current currency stays selectable even if it was deactivated since. A request that
  // changes the currency without a rate gets the new currency's rate for the entry date; one that
  // only re-sends lines keeps the entry's applied rate (never silently re-priced at today's rate).
  const currencyChanged = currency !== undefined || exchangeRate !== undefined;
  let convertedLines;
  if (currencyChanged || lines !== undefined) {
    const sameCurrency = currency === undefined || String(currency || 'EGP').trim().toUpperCase() === (entry.currency || 'EGP');
    const entryCurrency = await resolveEntryCurrency({
      currency: currency !== undefined ? currency : entry.currency,
      exchangeRate: exchangeRate !== undefined ? exchangeRate : sameCurrency ? entry.currencyUnitsPerBase : undefined,
      date: entry.date,
      currentCode: entry.currency,
    });
    convertedLines = applyCurrencyToLines(lines !== undefined ? lines : storedLinesAsInput(entry.lines), entryCurrency);
    entry.currency = entryCurrency.code;
    entry.currencyUnitsPerBase = entryCurrency.unitsPerBase;
  }

  // Re-applied whenever the lines OR the entry's project change, so the lines always follow the
  // entry's current Project (a project change on an unchanged set of lines re-stamps them too).
  if (convertedLines !== undefined || project !== undefined) {
    entry.lines = await applyEntryProjectToLines({ project: entry.project, lines: convertedLines !== undefined ? convertedLines : entry.lines.map(l => l.toObject({ depopulate: true })) });
  }

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
  // Revenue / cost recognition follows the project's executed percentage (a tracker on the project).
  // Reversing one entry by hand would leave the tracker and the ledger disagreeing; cancelling or
  // returning the Sales Order lowers the executed percentage and posts the reversal itself.
  // Return entries belong to their return (services/accounting/reversalService.js) - undoing one
  // by hand would leave the order's returned quantities and stock disagreeing with the ledger.
  if (original.accountingAction === 'PURCHASE_RETURN') {
    return next(new ApiError('A purchase return entry cannot be reversed by hand.', 400));
  }
  // Part of this entry was already reversed by a return: reversing all of it now would reverse the
  // returned part twice.
  if (await JournalEntry.exists({ reversalOfEntry: original._id })) {
    return next(new ApiError('Part of this entry was already reversed by a return, so it cannot be reversed in full.', 400));
  }
  if (['PROJECT_REVENUE_RECOGNITION', 'PROJECT_COST_RECOGNITION'].includes(original.accountingAction)) {
    return next(new ApiError("Revenue and cost recognition entries follow the project's executed percentage and cannot be reversed by hand. Cancel or return the Sales Invoice (or correct the project), which posts the reversal.", 400));
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

      // The shared mirror reversal (services/accounting/journalReversalCore.js) - the same one the
      // reversal engine uses, so an entry reversed from here or from its document is identical.
      ({ reversal } = await mirrorReverseEntry({ entryId: currentOriginal._id, date: reversalDate, reference, userId: req.user._id, session }));

      // A reversed depreciation entry gives its month back to the asset (Book Value, accumulated
      // depreciation), so the asset matches the ledger and the month can be depreciated again.
      if (currentOriginal.accountingAction === 'FIXED_ASSET_DEPRECIATION') {
        // eslint-disable-next-line global-require
        await require('../../services/fixedAssets/fixedAssetService').applyDepreciationReversal(currentOriginal._id, reversal._id, session);
      }
      // A reversed vendor payment stops counting as paid on its Purchase Order / Expense, and the
      // vendor and warehouse balances it moved are restored.
      // eslint-disable-next-line global-require
      await require('../../services/payments/paymentReversalService').applyPaymentReversal(currentOriginal, reversal, session);
      // A reversed advance application (at order creation) gives the amount back to the advance and
      // makes the order outstanding again.
      // eslint-disable-next-line global-require
      await require('../../services/accounting/reversalService').applySettlementEntryReversal(currentOriginal, session);
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
  createJournalEntryFilterObject,
  getJournalLineRules,
  getJournalEntry,
  getJournalEntriesForProject,
  getJournalEntriesForSalesOrder,
  getJournalEntriesForPurchaseOrder,
  getJournalEntriesForAdvancedPayment,
  updateJournalEntry,
  postJournalEntry,
  reverseJournalEntry,
  getGeneralLedger,
};
