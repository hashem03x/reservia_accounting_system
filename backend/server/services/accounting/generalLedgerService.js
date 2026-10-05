const JournalEntry = require('../../models/accounting/journalEntryModel');
const ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
const { AutomaticJournalAccountCodes } = require('../../utils/accountingConstants');

// Which control-account CODE a resolved Sub Account's party type corresponds to, for lines that
// predate the per-line `partyNumber`/`partyType` fields (see journalLineSchema) and so must fall
// back to resolveSubAccountsForEntries' entry-level resolution below. Scoping the fallback to ONLY
// the line whose account matches one of these codes is what keeps the fallback from stamping the
// same Sub Account onto every line of a multi-line entry (e.g. a Purchase Order receipt's
// Inventory/VAT/Withholding-Tax lines must stay blank - only the Suppliers line carries the Vendor
// Number) - see docs section "The Sub Account must represent the relevant business-party account".
const CUSTOMER_CONTROL_CODES = new Set([AutomaticJournalAccountCodes.accountsReceivableProjects, AutomaticJournalAccountCodes.customerAdvancesPayable]);
const VENDOR_CONTROL_CODES = new Set([AutomaticJournalAccountCodes.suppliers, AutomaticJournalAccountCodes.advanceToSuppliers]);

// Journal Entries are the single source of truth for the General Ledger - account balances are
// always derived from posted journal lines at read time, never stored/duplicated on the account
// document itself, so there is no second transaction system that can drift out of sync with the
// journal (see reversia master spec's "General Ledger" section).

const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Sum of posted debit/credit for a single account (matched by either the line's main `account`
 * or its `subAccount`), and the resulting balance.
 *
 * Sign convention: `balance = debit - credit`, unconditionally - NOT flipped by account type. A
 * liability/equity/revenue account with more credits than debits (its normal state) therefore
 * shows a NEGATIVE balance here. This is a deliberate, explicit requirement (confirmed with
 * worked examples showing e.g. Unearned Revenue at -100,000), not an oversight - see
 * docs/entities/accounting.md. An earlier version of this function flipped the sign for
 * liability/equity/revenue accounts to show a "natural" positive balance; that convention was
 * replaced by this one.
 */
async function getAccountBalance(accountId) {
  const account = await ChartOfAccount.findById(accountId);
  if (!account) return null;

  const [totals] = await JournalEntry.aggregate([
    { $match: { status: 'posted' } },
    { $unwind: '$lines' },
    { $match: { $or: [{ 'lines.account': account._id }, { 'lines.subAccount': account._id }] } },
    { $group: { _id: null, debit: { $sum: '$lines.debit' }, credit: { $sum: '$lines.credit' } } },
  ]);

  const debit = totals?.debit || 0;
  const credit = totals?.credit || 0;

  return {
    account: { _id: account._id, code: account.code, name: account.name, type: account.type },
    debit: round2(debit),
    credit: round2(credit),
    balance: round2(debit - credit),
  };
}

/**
 * Trial balance - every account with at least one posted line, per-account debit/credit totals
 * and `balance` (`debit - credit`, same unconditional sign convention as getAccountBalance).
 * A single aggregation query, not one query per account, so this scales with the number of
 * distinct accounts touched rather than the number of accounts that exist or the number of
 * journal entries posted.
 */
async function getTrialBalance() {
  const rows = await JournalEntry.aggregate([
    { $match: { status: 'posted' } },
    { $unwind: '$lines' },
    { $group: { _id: '$lines.account', debit: { $sum: '$lines.debit' }, credit: { $sum: '$lines.credit' } } },
    { $lookup: { from: 'chartofaccounts', localField: '_id', foreignField: '_id', as: 'account' } },
    { $unwind: '$account' },
    { $sort: { 'account.code': 1 } },
    {
      $project: {
        _id: 0,
        account: { _id: '$account._id', code: '$account.code', name: '$account.name', type: '$account.type' },
        debit: 1,
        credit: 1,
      },
    },
  ]);

  return rows.map(row => ({ ...row, debit: round2(row.debit), credit: round2(row.credit), balance: round2(row.debit - row.credit) }));
}

// ---------------------------------------------------------------------------
// General Ledger line view (docs section "Journal Entries / General Ledger table") - a flattened,
// one-row-per-LINE view across every posted entry, each row carrying a running balance for ITS
// OWN account (see computeRunningBalances below) plus a resolved customer/vendor "Sub Account".
// This is purely a READ/display concern layered on top of the existing JournalEntry data - it
// introduces no new write path, no new accounting rule, and no change to how entries are created,
// posted, or reversed.
// ---------------------------------------------------------------------------

/**
 * For each given (already-fetched) JournalEntry, resolves the customer/vendor the entry's own
 * `sourceType`/`sourceId` relates to, down to that party's real Customer Number / Vendor Number -
 * never a name, never a MongoDB _id (docs section "Sub Account Mapping"). Entirely read-only:
 * looks up the EXISTING relationship each automatic accounting flow already records
 * (SalesOrder.customer, PurchaseOrder.vendorId, Payment.customerId/vendorId,
 * AdvancedPayment.customer/vendor, Project.customer) - no new relationship is introduced.
 *
 * Batched per sourceType (one query per type, not one query per entry) so this scales with the
 * number of DISTINCT source documents on a page, not the number of entries.
 *
 * @returns {Promise<Map<string, {type: 'customer'|'vendor', number: number} | null>>} keyed by
 *   entry._id.toString()
 */
async function resolveSubAccountsForEntries(entries) {
  const result = new Map();
  const bySourceType = new Map();
  for (const entry of entries) {
    if (!entry.sourceType || !entry.sourceId) continue;
    if (!bySourceType.has(entry.sourceType)) bySourceType.set(entry.sourceType, []);
    bySourceType.get(entry.sourceType).push(entry);
  }
  if (bySourceType.size === 0) return result;

  const User = require('../../models/userModel'); // eslint-disable-line global-require
  const Vendor = require('../../models/vendor/vendor'); // eslint-disable-line global-require

  // Several of the sub-queries below (SalesOrder.customer, PurchaseOrder.vendorId,
  // AdvancedPayment.customer/vendor, Project.customer) run through models whose OWN
  // pre(/^find/) hook populates that exact path unconditionally - even with `.lean()`, even with
  // a `.select()` that only asks for the id field. Every reference read from one of those
  // documents is therefore a populated object, not a raw ObjectId, and MUST be normalized through
  // this helper before use - the same "populated object vs raw id" pitfall documented repeatedly
  // elsewhere in this codebase (e.g. advancedPaymentModel.js's project/customer comparisons).
  const idOf = ref => (ref ? (ref._id || ref).toString() : null);

  async function numbersFor({ customerIds = [], vendorIds = [] }) {
    const [customers, vendors] = await Promise.all([
      customerIds.length ? User.find({ _id: { $in: customerIds } }).select('customerNumber').lean() : [],
      vendorIds.length ? Vendor.find({ _id: { $in: vendorIds } }).select('vendorNumber').lean() : [],
    ]);
    return {
      customerNumberById: new Map(customers.map(c => [c._id.toString(), c.customerNumber])),
      vendorNumberById: new Map(vendors.map(v => [v._id.toString(), v.vendorNumber])),
    };
  }

  // SO -> SalesOrder.customer (User)
  if (bySourceType.has('SO')) {
    const SalesOrder = require('../../models/sales/salesOrderModel'); // eslint-disable-line global-require
    const soEntries = bySourceType.get('SO');
    const orders = await SalesOrder.find({ _id: { $in: soEntries.map(e => e.sourceId) } }).select('customer').lean();
    const orderById = new Map(orders.map(o => [o._id.toString(), idOf(o.customer)]));
    const { customerNumberById } = await numbersFor({ customerIds: [...orderById.values()].filter(Boolean) });
    for (const entry of soEntries) {
      const customerId = orderById.get(entry.sourceId.toString());
      const number = customerId ? customerNumberById.get(customerId) : undefined;
      result.set(entry._id.toString(), number != null ? { type: 'customer', number } : null);
    }
  }

  // PO -> PurchaseOrder.vendorId (Vendor)
  if (bySourceType.has('PO')) {
    const PurchaseOrder = require('../../models/vendor/purchaseOrder'); // eslint-disable-line global-require
    const poEntries = bySourceType.get('PO');
    const orders = await PurchaseOrder.find({ _id: { $in: poEntries.map(e => e.sourceId) } }).select('vendorId').lean();
    const vendorIdByOrderId = new Map(orders.map(o => [o._id.toString(), idOf(o.vendorId)]));
    const { vendorNumberById } = await numbersFor({ vendorIds: [...vendorIdByOrderId.values()].filter(Boolean) });
    for (const entry of poEntries) {
      const vendorId = vendorIdByOrderId.get(entry.sourceId.toString());
      const number = vendorId ? vendorNumberById.get(vendorId) : undefined;
      result.set(entry._id.toString(), number != null ? { type: 'vendor', number } : null);
    }
  }

  // PAYMENT -> Payment.customerId XOR vendorId (Payment does not populate either path, but
  // normalized through idOf() anyway for consistency/future-proofing)
  if (bySourceType.has('PAYMENT')) {
    const Payment = require('../../models/vendor/paymentModel'); // eslint-disable-line global-require
    const paymentEntries = bySourceType.get('PAYMENT');
    const payments = await Payment.find({ _id: { $in: paymentEntries.map(e => e.sourceId) } }).select('customerId vendorId').lean();
    const paymentById = new Map(payments.map(p => [p._id.toString(), { customerId: idOf(p.customerId), vendorId: idOf(p.vendorId) }]));
    const { customerNumberById, vendorNumberById } = await numbersFor({
      customerIds: [...paymentById.values()].map(p => p.customerId).filter(Boolean),
      vendorIds: [...paymentById.values()].map(p => p.vendorId).filter(Boolean),
    });
    for (const entry of paymentEntries) {
      const payment = paymentById.get(entry.sourceId.toString());
      if (payment?.customerId) {
        const number = customerNumberById.get(payment.customerId);
        result.set(entry._id.toString(), number != null ? { type: 'customer', number } : null);
      } else if (payment?.vendorId) {
        const number = vendorNumberById.get(payment.vendorId);
        result.set(entry._id.toString(), number != null ? { type: 'vendor', number } : null);
      } else {
        result.set(entry._id.toString(), null);
      }
    }
  }

  // ADVANCED_PAYMENT -> AdvancedPayment.customer (type 'customer') or .vendor (type 'vendor')
  if (bySourceType.has('ADVANCED_PAYMENT')) {
    const AdvancedPayment = require('../../models/payments/advancedPaymentModel'); // eslint-disable-line global-require
    const advEntries = bySourceType.get('ADVANCED_PAYMENT');
    const advances = await AdvancedPayment.find({ _id: { $in: advEntries.map(e => e.sourceId) } }).select('type customer vendor').lean();
    const advanceById = new Map(advances.map(a => [a._id.toString(), { type: a.type, customerId: idOf(a.customer), vendorId: idOf(a.vendor) }]));
    const { customerNumberById, vendorNumberById } = await numbersFor({
      customerIds: [...advanceById.values()].filter(a => a.type === 'customer').map(a => a.customerId).filter(Boolean),
      vendorIds: [...advanceById.values()].filter(a => a.type === 'vendor').map(a => a.vendorId).filter(Boolean),
    });
    for (const entry of advEntries) {
      const advance = advanceById.get(entry.sourceId.toString());
      if (advance?.type === 'customer' && advance.customerId) {
        const number = customerNumberById.get(advance.customerId);
        result.set(entry._id.toString(), number != null ? { type: 'customer', number } : null);
      } else if (advance?.type === 'vendor' && advance.vendorId) {
        const number = vendorNumberById.get(advance.vendorId);
        result.set(entry._id.toString(), number != null ? { type: 'vendor', number } : null);
      } else {
        result.set(entry._id.toString(), null);
      }
    }
  }

  // PROJECT -> Project.customer (revenue/cost recognition - docs section "Project - Executed
  // Percentage"). Note: `entry.sourceId` for these is a deterministic hash (see
  // accountingEventService.js#deterministicSourceId), NOT the real project id - the entry-level
  // `project` reference (already populated by the main query) is the real link to use here.
  if (bySourceType.has('PROJECT')) {
    const Project = require('../../models/project/projectModel'); // eslint-disable-line global-require
    const projectEntries = bySourceType.get('PROJECT');
    const projectIds = projectEntries.map(e => idOf(e.project)).filter(Boolean);
    const projects = await Project.find({ _id: { $in: projectIds } }).select('customer').lean();
    const customerIdByProjectId = new Map(projects.map(p => [p._id.toString(), idOf(p.customer)]));
    const { customerNumberById } = await numbersFor({ customerIds: [...customerIdByProjectId.values()].filter(Boolean) });
    for (const entry of projectEntries) {
      const projectId = idOf(entry.project);
      const customerId = projectId ? customerIdByProjectId.get(projectId) : null;
      const number = customerId ? customerNumberById.get(customerId) : undefined;
      result.set(entry._id.toString(), number != null ? { type: 'customer', number } : null);
    }
  }

  return result;
}

/**
 * Running balance ("Balance = Previous Balance + Debit - Credit", "respects existing journal-entry
 * ordering" - docs section "Balance (Document/Local Currency)"), computed per account across that
 * account's ENTIRE posted history (never just the current page - a page boundary must never reset
 * or skew a real running balance), via MongoDB's $setWindowFields rather than any React-side
 * accounting math. Also computes the local-currency running balance in the same pass
 * (`(debit-credit) * (exchangeRate ?? 1)`, cumulative - docs section "Balance (Local Currency)"),
 * reusing the same `exchangeRate` every other currency-aware feature in this app already stores,
 * never a second conversion mechanism.
 *
 * @returns {Promise<Map<string, {balance: number, localBalance: number}>>} keyed by
 *   `${entryId}:${lineIndex}` - lineIndex is the line's position within its own entry's `lines[]`
 *   array (stable even when an entry has more than one line on the same account).
 */
async function computeRunningBalances(accountIds) {
  const map = new Map();
  if (accountIds.length === 0) return map;

  const rows = await JournalEntry.aggregate([
    { $match: { status: 'posted' } },
    { $unwind: { path: '$lines', includeArrayIndex: 'lineIndex' } },
    { $match: { 'lines.account': { $in: accountIds } } },
    {
      $setWindowFields: {
        partitionBy: '$lines.account',
        sortBy: { date: 1, entryNumber: 1, lineIndex: 1 },
        output: {
          runningBalance: {
            $sum: { $subtract: ['$lines.debit', '$lines.credit'] },
            window: { documents: ['unbounded', 'current'] },
          },
          runningLocalBalance: {
            $sum: { $multiply: [{ $subtract: ['$lines.debit', '$lines.credit'] }, { $ifNull: ['$lines.exchangeRate', 1] }] },
            window: { documents: ['unbounded', 'current'] },
          },
        },
      },
    },
    { $project: { _id: 0, entryId: '$_id', lineIndex: 1, runningBalance: 1, runningLocalBalance: 1 } },
  ]);

  rows.forEach(row => {
    map.set(`${row.entryId.toString()}:${row.lineIndex}`, { balance: round2(row.runningBalance), localBalance: round2(row.runningLocalBalance) });
  });
  return map;
}

/**
 * The flattened, paginated General Ledger line list - one row per JournalEntry line, in
 * chronological order (oldest first, matching how a running balance must be read). Pagination is
 * at the ENTRY level (same semantics as every other paginated list in this app - `page`/`limit`
 * map directly onto `ApiFeatures.paginate()`'s existing response shape, see handlersFactory.js),
 * so the frontend's existing PaginationHandler/PaginatedData<T> work unmodified; a page's "rows"
 * are simply every line of every entry on that page. Only `status: 'posted'` entries are included,
 * matching getAccountBalance/getTrialBalance's existing convention - a draft entry has no real
 * ledger effect yet.
 */
async function getGeneralLedgerLines({ page = 1, limit = 50 } = {}) {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.max(1, parseInt(limit, 10) || 50);
  const skip = (pageNum - 1) * limitNum;

  const countDocuments = await JournalEntry.countDocuments({ status: 'posted' });
  const entries = await JournalEntry.find({ status: 'posted' })
    .sort({ date: 1, entryNumber: 1 })
    .skip(skip)
    .limit(limitNum);

  const [subAccountByEntryId, runningBalanceByKey] = await Promise.all([
    resolveSubAccountsForEntries(entries),
    computeRunningBalances([...new Set(entries.flatMap(e => e.lines.map(l => l.account?._id || l.account)))]),
  ]);

  const rows = [];
  entries.forEach(entry => {
    entry.lines.forEach((line, lineIndex) => {
      const accountId = (line.account?._id || line.account)?.toString();
      const running = runningBalanceByKey.get(`${entry._id.toString()}:${lineIndex}`) || { balance: 0, localBalance: 0 };
      // Project Number: prefer the LIVE project's own projectNumber (already populated via this
      // schema's own pre(/^find/) hook) over the denormalized `line.projectNumber` string, which
      // the automatic accounting engine never set (only the manual Journal Entry form does) - see
      // docs section "Project Number". Falls back to the denormalized string, then to null -
      // never fabricated.
      const projectNumber = line.project?.projectNumber || line.projectNumber || null;

      // Sub Account (docs section "Sub Account behavior"): prefer the line's OWN partyNumber/
      // partyType, written once at creation time by the automatic accounting engine - this is the
      // authoritative, line-scoped value and the only thing checked for every entry created going
      // forward. Falls back to the older entry-wide resolveSubAccountsForEntries lookup ONLY for a
      // line that has neither field set (a historical entry predating this feature) AND whose own
      // account is actually one of the relevant control-account codes for the resolved party type -
      // this keeps even the fallback from stamping a Vendor/Customer Number onto an unrelated line
      // (e.g. the Inventory/VAT lines of a Purchase Order receipt) the way the original blanket,
      // entry-wide version of this lookup used to.
      let subAccount = null;
      if (line.partyType && line.partyNumber != null) {
        subAccount = { type: line.partyType, number: line.partyNumber };
      } else {
        const resolved = subAccountByEntryId.get(entry._id.toString());
        if (resolved && line.account?.code) {
          const relevantCodes = resolved.type === 'customer' ? CUSTOMER_CONTROL_CODES : VENDOR_CONTROL_CODES;
          if (relevantCodes.has(line.account.code)) subAccount = resolved;
        }
      }

      rows.push({
        entryId: entry._id,
        lineIndex,
        documentDate: entry.date,
        documentNumber: entry.entryNumber,
        accNumber: line.account?.code || null,
        accName: line.account?.name || null,
        accountId,
        subAccount,
        projectNumber,
        currency: line.currency || null,
        rate: line.exchangeRate ?? 1,
        debit: line.debit || 0,
        credit: line.credit || 0,
        balanceDocumentCurrency: running.balance,
        balanceLocalCurrency: running.localBalance,
        description: line.description || entry.description || null,
        module: entry.module || null,
      });
    });
  });

  return {
    results: rows.length,
    paginationResult: {
      currentPage: pageNum,
      limit: limitNum,
      numberOfPages: Math.ceil(countDocuments / limitNum),
      ...(skip + limitNum < countDocuments ? { next: pageNum + 1 } : {}),
      ...(skip > 0 ? { prev: pageNum - 1 } : {}),
    },
    data: rows,
  };
}

module.exports = { getAccountBalance, getTrialBalance, getGeneralLedgerLines };
