const Project = require('../../models/project/projectModel');
const SalesOrder = require('../../models/sales/salesOrderModel');
const Requisition = require('../../models/vendor/requisitionModel');
const PurchaseOrder = require('../../models/vendor/purchaseOrder');
const Vendor = require('../../models/vendor/vendor');
const ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
const { getTrialBalanceAsOf } = require('../accounting/generalLedgerService');
const { CashEquivalentParentGroupName } = require('../../utils/accountingConstants');
const { calculateDueDate } = require('../../utils/helpers/dueDate');
const { buildPaymentSchedule } = require('../../utils/helpers/paymentSchedule');

// Projected Cash Flow - Phase 1 (docs section "Projected Cash Flow Forecasting and PO Cash-Out
// Forecast"). Purely a READ-ONLY aggregation over data that already exists - no new field on any
// existing model, no hook added anywhere, no journal entry ever posted from this file. Every
// figure here is DERIVED at read time from SalesOrder/PurchaseOrder/Requisition/Project documents
// that other, already-existing flows create and maintain; this service never writes to any of
// them.
//
// Phase 2 ("PO Cash-Out Forecast" due-dating): an open (non-draft, non-cancelled) Requisition's
// own uninvoiced remainder is now dated from its vendor's Payment Terms
// (utils/helpers/dueDate.js#calculateDueDate for a flat due date, or
// utils/helpers/paymentSchedule.js#buildPaymentSchedule for one row per installment when the
// vendor has installments configured) - reusing the exact same helpers the Purchase Invoice's own
// `dueDate`/`paymentSchedule` snapshot already calls, never new date math. A vendor with no usable
// terms (missing, or Custom with no customPaymentDays, or installments with no rows) still falls
// back to `unscheduled`/`date: null` - never an invented date - so it stays identifiable for
// correction (reason: 'vendor_missing_payment_terms'). Once a Purchase Invoice exists against a
// Requisition, double counting is already prevented arithmetically: the invoice's own
// `invoicedAmount` increment (purchaseOrder.js) shrinks `amount - invoicedAmount` below by the same
// amount the invoice itself now separately (and correctly) contributes via its own `dueDate`.

const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_HORIZON_DAYS = 30;
const DUE_SOON_DAYS = 7;

// =============================================================
// Date range / granularity
// =============================================================

// UTC, not local server time - matches the rest of the codebase's date-bucketing convention
// (financialDashboardService.js's `$dateToString` explicitly uses `timezone: 'UTC'`). Using local
// time here would make bucket boundaries - and therefore which day a due date lands in - depend
// on the server process's own timezone, silently shifting every date by a few hours depending on
// where this happens to be deployed.
function startOfDay(date) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function resolveDateRange(from, to) {
  const start = from ? startOfDay(new Date(from)) : startOfDay(new Date());
  let end = to ? startOfDay(new Date(to)) : startOfDay(new Date(start.getTime() + DEFAULT_HORIZON_DAYS * DAY_MS));
  if (Number.isNaN(start.getTime())) throw new Error('Invalid "from" date.');
  if (Number.isNaN(end.getTime())) throw new Error('Invalid "to" date.');
  if (end < start) end = start;
  return { from: start, to: end };
}

// Explicit `granularity` always wins; otherwise a sensible default from the horizon length (docs
// section "Forecast Timeline and Reporting").
function resolveGranularity(from, to, requested) {
  if (requested === 'day' || requested === 'week' || requested === 'month') return requested;
  const days = Math.round((to - from) / DAY_MS) + 1;
  if (days <= 31) return 'day';
  if (days <= 180) return 'week';
  return 'month';
}

function bucketKeyAndRange(date, granularity, rangeStart) {
  if (granularity === 'day') {
    const key = date.toISOString().slice(0, 10);
    return { key, from: startOfDay(date), to: startOfDay(date) };
  }
  if (granularity === 'week') {
    // Fixed 7-day windows anchored to the forecast's own start date (not calendar ISO weeks) -
    // simple, unambiguous, and matches "the closing balance of one period becomes the opening
    // balance of the next" without any ISO-week edge cases.
    const daysSinceStart = Math.floor((startOfDay(date) - rangeStart) / DAY_MS);
    const weekIndex = Math.floor(daysSinceStart / 7);
    const weekStart = new Date(rangeStart.getTime() + weekIndex * 7 * DAY_MS);
    const weekEnd = new Date(weekStart.getTime() + 6 * DAY_MS);
    return { key: `W${weekIndex}-${weekStart.toISOString().slice(0, 10)}`, from: weekStart, to: weekEnd };
  }
  // month (UTC, same reasoning as startOfDay above)
  const monthStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
  const key = `${monthStart.getUTCFullYear()}-${String(monthStart.getUTCMonth() + 1).padStart(2, '0')}`;
  return { key, from: monthStart, to: monthEnd };
}

function buildEmptyBuckets(from, to, granularity) {
  const buckets = [];
  const seen = new Set();
  let cursor = new Date(from);
  while (cursor <= to) {
    const { key, from: bFrom, to: bTo } = bucketKeyAndRange(cursor, granularity, from);
    if (!seen.has(key)) {
      seen.add(key);
      buckets.push({ key, from: bFrom, to: bTo, inflow: 0, outflow: 0 });
    }
    cursor = new Date(cursor.getTime() + DAY_MS);
  }
  return buckets;
}

// =============================================================
// Status derivation (docs section "Forecast Accuracy and Statuses") - always derived, never
// stored. "Settled" is never reached here by design: a fully-paid document has remainingAmount 0
// and is filtered out before this is ever called, so a forecast line can never be "marked
// settled merely because an invoice was created" - it simply stops being a forecast line.
// =============================================================

function deriveScheduledStatus(date, paymentStatus) {
  if (paymentStatus === 'partial') return 'partially_paid';
  const now = startOfDay(new Date());
  if (date < now) return 'overdue';
  if (date - now <= DUE_SOON_DAYS * DAY_MS) return 'due_soon';
  return 'forecast';
}

// =============================================================
// Customer inflow obligations (per Project)
// =============================================================

/**
 * @param {{projectIds?: string[]|null, customerId?: string|null}} opts
 * @returns {Promise<{projects: object[], scheduled: object[], unscheduled: object[]}>}
 */
async function getCustomerInflowObligations({ projectIds = null, customerId = null } = {}) {
  const projectFilter = { isDeleted: { $ne: true }, status: { $ne: 'cancelled' } };
  if (projectIds) projectFilter._id = { $in: projectIds };
  if (customerId) projectFilter.customer = customerId;

  const projects = await Project.find(projectFilter).select('_id projectNumber name contractValue customer status').lean();
  const ids = projects.map(p => p._id);
  if (ids.length === 0) return { projects: [], scheduled: [], unscheduled: [] };

  const invoicedTotalsRaw = await SalesOrder.aggregate([
    { $match: { project: { $in: ids }, orderStatus: { $ne: 'canceled' } } },
    { $group: { _id: '$project', total: { $sum: '$totalAmount' } } },
  ]);
  const invoicedByProject = new Map(invoicedTotalsRaw.map(r => [r._id.toString(), r.total]));

  const openOrders = await SalesOrder.find({
    project: { $in: ids },
    orderStatus: { $ne: 'canceled' },
    remainingAmount: { $gt: 0 },
  })
    .select('code project customer grandTotal paidAmount remainingAmount dueDate paymentStatus createdAt')
    .lean();

  const scheduled = [];
  const unscheduled = [];

  for (const so of openOrders) {
    const amount = round2(so.remainingAmount);
    const base = {
      direction: 'in',
      source: 'salesOrder',
      sourceId: so._id,
      code: so.code || null,
      project: so.project || null,
      party: so.customer || null,
      amount,
      paymentStatus: so.paymentStatus,
    };
    if (so.dueDate) {
      scheduled.push({ ...base, date: new Date(so.dueDate), status: deriveScheduledStatus(new Date(so.dueDate), so.paymentStatus) });
    } else {
      unscheduled.push({ ...base, date: null, status: 'unscheduled', reason: 'invoice_missing_due_date' });
    }
  }

  for (const p of projects) {
    const invoiced = invoicedByProject.get(p._id.toString()) || 0;
    if (!p.contractValue) {
      // No contract value at all - the spec's own instruction: flag, never silently show zero.
      unscheduled.push({
        direction: 'in',
        source: 'project',
        sourceId: p._id,
        project: { _id: p._id, projectNumber: p.projectNumber, name: p.name },
        party: null,
        amount: 0,
        date: null,
        status: 'cannot_calculate',
        reason: 'missing_contract_value',
      });
      continue;
    }
    const remainder = Math.max(0, round2(p.contractValue - invoiced));
    if (remainder > 0) {
      unscheduled.push({
        direction: 'in',
        source: 'project',
        sourceId: p._id,
        project: { _id: p._id, projectNumber: p.projectNumber, name: p.name },
        party: p.customer || null,
        amount: remainder,
        date: null,
        status: 'unscheduled',
        reason: 'uninvoiced_contract_remainder',
      });
    }
  }

  return { projects, scheduled, unscheduled };
}

// =============================================================
// Vendor outflow obligations (per Requisition / Purchase Order)
// =============================================================

/**
 * @param {{projectIds?: string[]|null, vendorId?: string|null}} opts
 * @returns {Promise<{requisitions: object[], scheduled: object[], unscheduled: object[]}>}
 */
async function getVendorOutflowObligations({ projectIds = null, vendorId = null } = {}) {
  const requisitionFilter = { status: { $ne: 'cancelled' } };
  if (projectIds) requisitionFilter.project = { $in: projectIds };
  if (vendorId) requisitionFilter.vendorId = vendorId;

  const requisitions = await Requisition.find(requisitionFilter)
    .select('code vendorId project amount invoicedAmount status createdAt')
    .lean();

  const invoiceFilter = { remainingAmount: { $gt: 0 } };
  if (projectIds) invoiceFilter.project = { $in: projectIds };
  if (vendorId) invoiceFilter.vendorId = vendorId;

  const openInvoices = await PurchaseOrder.find(invoiceFilter)
    .select('code vendorId project requisition grandTotal paidAmount remainingAmount dueDate paymentStatus createdAt')
    .lean();

  const scheduled = [];
  const unscheduled = [];

  // Payment terms for every requisition's vendor, batch-fetched once (the Requisition model's own
  // `pre(/^find/)` auto-populate only ever selects `name vendorNumber contact.phone contact.email`
  // for display elsewhere - never these accounting fields, and that global hook is intentionally
  // left untouched here rather than widened for every other caller).
  const vendorIds = [...new Set(requisitions.map(r => r.vendorId?._id).filter(Boolean).map(id => id.toString()))];
  const vendorTermsDocs = vendorIds.length
    ? await Vendor.find({ _id: { $in: vendorIds } }).select('paymentTerms customPaymentDays paymentTermsConfig').lean()
    : [];
  const vendorTermsById = new Map(vendorTermsDocs.map(v => [v._id.toString(), v]));

  function hasUsablePaymentTerms(vendorTerms) {
    if (!vendorTerms || !vendorTerms.paymentTerms) return false;
    if (vendorTerms.paymentTerms === 'Custom' && (vendorTerms.customPaymentDays === null || vendorTerms.customPaymentDays === undefined)) return false;
    if (vendorTerms.paymentTermsConfig?.kind === 'installments' && !(vendorTerms.paymentTermsConfig.installments || []).length) return false;
    return true;
  }

  for (const inv of openInvoices) {
    const amount = round2(inv.remainingAmount);
    const base = {
      direction: 'out',
      source: 'purchaseInvoice',
      sourceId: inv._id,
      code: inv.code || null,
      project: inv.project || null,
      party: inv.vendorId || null,
      requisition: inv.requisition || null,
      amount,
      paymentStatus: inv.paymentStatus,
    };
    if (inv.dueDate) {
      scheduled.push({ ...base, date: new Date(inv.dueDate), status: deriveScheduledStatus(new Date(inv.dueDate), inv.paymentStatus) });
    } else {
      unscheduled.push({ ...base, date: null, status: 'unscheduled', reason: 'invoice_missing_due_date' });
    }
  }

  for (const req of requisitions) {
    // amount - invoicedAmount, the exact same guarded figure the Purchase Invoice's own atomic
    // increment maintains (purchaseOrder.js) - never recomputed here, just read. This is also what
    // prevents double counting once an invoice exists: as soon as any amount is invoiced, this
    // remainder shrinks by exactly that amount, while the invoice itself separately (and only
    // then) contributes its own remainingAmount via `openInvoices` above.
    const remainder = Math.max(0, round2((req.amount || 0) - (req.invoicedAmount || 0)));
    if (remainder <= 0) continue;

    const base = {
      direction: 'out',
      source: 'requisition',
      sourceId: req._id,
      code: req.code || null,
      project: req.project || null,
      party: req.vendorId || null,
      requisition: req._id,
    };

    // A draft Purchase Order isn't finalized yet - never date it (unchanged from before).
    if (req.status === 'draft') {
      unscheduled.push({ ...base, amount: remainder, date: null, status: 'draft', reason: 'purchase_order_still_draft' });
      continue;
    }

    const vendorTerms = req.vendorId?._id ? vendorTermsById.get(req.vendorId._id.toString()) : null;
    if (!hasUsablePaymentTerms(vendorTerms)) {
      // No payment terms or no usable due date exists - never invent one (docs decision), but
      // still identifiable for correction via `reason`.
      unscheduled.push({ ...base, amount: remainder, date: null, status: 'unscheduled', reason: 'vendor_missing_payment_terms' });
      continue;
    }

    // The Requisition has no date field of its own besides `createdAt` (by design - see this
    // model's header comment) - the same base date the Purchase Invoice's pre-save hook uses
    // (`new Date()` at invoice-creation time) would use if this PO were invoiced today.
    const baseDate = req.createdAt;

    if (vendorTerms.paymentTermsConfig?.kind === 'installments') {
      const rows = buildPaymentSchedule(vendorTerms.paymentTermsConfig, baseDate, remainder);
      for (const row of rows) {
        scheduled.push({ ...base, amount: row.amount, date: row.dueDate, status: deriveScheduledStatus(row.dueDate) });
      }
    } else {
      const dueDate = calculateDueDate(baseDate, vendorTerms.paymentTerms, vendorTerms.customPaymentDays);
      scheduled.push({ ...base, amount: remainder, date: dueDate, status: deriveScheduledStatus(dueDate) });
    }
  }

  return { requisitions, scheduled, unscheduled };
}

// =============================================================
// Opening cash balance (docs section "Forecast Timeline and Reporting" - company-wide opening
// balance derived from eligible cash/cash-equivalent accounts). Reuses the exact two-signal
// eligibility query the dashboard already uses (dashboardService.js), just as-of a chosen date
// instead of "now".
// =============================================================

async function getOpeningCashBalance(asOfDate) {
  const [cashAccounts, trialBalance] = await Promise.all([
    ChartOfAccount.find({
      type: 'asset',
      isActive: true,
      $or: [{ parentGroupNameEn: CashEquivalentParentGroupName }, { state: { $in: ['cash', 'cash-equivalent'] } }],
    })
      .select('code name nameAr')
      .lean(),
    getTrialBalanceAsOf(asOfDate),
  ]);

  const balanceByAccountId = new Map(trialBalance.map(row => [row.account._id.toString(), row.balance]));
  const accounts = cashAccounts.map(a => ({
    _id: a._id,
    code: a.code,
    name: a.name,
    nameAr: a.nameAr,
    balance: round2(balanceByAccountId.get(a._id.toString()) || 0),
  }));
  const total = round2(accounts.reduce((sum, a) => sum + a.balance, 0));
  return { total, accounts };
}

// =============================================================
// Timeline (opening -> inflow/outflow -> closing per bucket, chained)
// =============================================================

function buildTimeline({ scheduledInflows, scheduledOutflows, openingBalance, from, to, granularity }) {
  const buckets = buildEmptyBuckets(from, to, granularity);
  const byKey = new Map(buckets.map(b => [b.key, b]));

  for (const item of scheduledInflows) {
    if (item.date < from || item.date > to) continue;
    const { key } = bucketKeyAndRange(item.date, granularity, from);
    const bucket = byKey.get(key);
    if (bucket) bucket.inflow = round2(bucket.inflow + item.amount);
  }
  for (const item of scheduledOutflows) {
    if (item.date < from || item.date > to) continue;
    const { key } = bucketKeyAndRange(item.date, granularity, from);
    const bucket = byKey.get(key);
    if (bucket) bucket.outflow = round2(bucket.outflow + item.amount);
  }

  let running = openingBalance;
  const timeline = buckets.map(b => {
    const opening = running;
    const closing = round2(opening + b.inflow - b.outflow);
    running = closing;
    return { period: b.key, from: b.from, to: b.to, opening, inflow: b.inflow, outflow: b.outflow, net: round2(b.inflow - b.outflow), closing, shortfall: closing < 0 };
  });
  return timeline;
}

// =============================================================
// Filters shared by both entry points (docs section "Forecast Timeline and Reporting")
// =============================================================

function applyCommonFilters(items, { status, poNumber, invoiceNumber } = {}) {
  let result = items;
  if (status) result = result.filter(i => i.status === status);
  if (poNumber) result = result.filter(i => i.requisition && String(i.requisition.code || '') === poNumber);
  if (invoiceNumber) result = result.filter(i => i.code === invoiceNumber);
  return result;
}

function sumAmount(items) {
  return round2(items.reduce((sum, i) => sum + i.amount, 0));
}

function buildTotals({ scheduled, unscheduled, direction }, opposite) {
  const scheduledOwn = scheduled.filter(i => i.direction === direction);
  const unscheduledOwn = unscheduled.filter(i => i.direction === direction);
  return {
    scheduled: sumAmount(scheduledOwn),
    unscheduled: sumAmount(unscheduledOwn),
    overdue: sumAmount(scheduledOwn.filter(i => i.status === 'overdue')),
  };
}

// =============================================================
// Public entry points
// =============================================================

/**
 * Company-wide consolidated forecast (docs section "Consolidated Company Cash Flow").
 */
async function getConsolidatedForecast(params = {}) {
  const { from, to, granularity: requestedGranularity, project, customer, vendor, direction, status, poNumber, invoiceNumber } = params;
  const range = resolveDateRange(from, to);
  const granularity = resolveGranularity(range.from, range.to, requestedGranularity);
  const projectIds = project ? [project] : null;

  const [customerData, vendorData, opening] = await Promise.all([
    getCustomerInflowObligations({ projectIds, customerId: customer || null }),
    getVendorOutflowObligations({ projectIds, vendorId: vendor || null }),
    getOpeningCashBalance(range.from),
  ]);

  let scheduled = [...customerData.scheduled, ...vendorData.scheduled];
  let unscheduled = [...customerData.unscheduled, ...vendorData.unscheduled];
  scheduled = applyCommonFilters(scheduled, { status, poNumber, invoiceNumber });
  unscheduled = applyCommonFilters(unscheduled, { status, poNumber, invoiceNumber });
  if (direction === 'in' || direction === 'out') {
    scheduled = scheduled.filter(i => i.direction === direction);
    unscheduled = unscheduled.filter(i => i.direction === direction);
  }

  const timeline = buildTimeline({
    scheduledInflows: scheduled.filter(i => i.direction === 'in'),
    scheduledOutflows: scheduled.filter(i => i.direction === 'out'),
    openingBalance: opening.total,
    from: range.from,
    to: range.to,
    granularity,
  });

  const inflowTotals = buildTotals({ scheduled, unscheduled, direction: 'in' });
  const outflowTotals = buildTotals({ scheduled, unscheduled, direction: 'out' });
  const closingBalance = timeline.length ? timeline[timeline.length - 1].closing : opening.total;

  // Project-level net (unweighted by date) - a simplified "which projects could be short" signal,
  // not a precise timeline; precise per-project timing is available via getProjectForecast.
  const perProjectNet = new Map();
  for (const item of [...scheduled, ...unscheduled].filter(i => i.project)) {
    const key = item.project._id.toString();
    const entry = perProjectNet.get(key) || { project: item.project, net: 0 };
    entry.net = round2(entry.net + (item.direction === 'in' ? item.amount : -item.amount));
    perProjectNet.set(key, entry);
  }
  const shortfallProjects = [...perProjectNet.values()].filter(e => e.net < 0);

  return {
    range,
    granularity,
    opening,
    timeline,
    totals: {
      expectedReceipts: inflowTotals.scheduled,
      expectedPayments: outflowTotals.scheduled,
      unscheduledReceipts: inflowTotals.unscheduled,
      unscheduledPayments: outflowTotals.unscheduled,
      netProjected: round2(inflowTotals.scheduled - outflowTotals.scheduled),
      openingBalance: opening.total,
      closingBalance,
      overdueReceipts: inflowTotals.overdue,
      overduePayments: outflowTotals.overdue,
    },
    shortfallProjects,
    obligations: { inflows: [...scheduled.filter(i => i.direction === 'in'), ...unscheduled.filter(i => i.direction === 'in')], outflows: [...scheduled.filter(i => i.direction === 'out'), ...unscheduled.filter(i => i.direction === 'out')] },
  };
}

/**
 * Single-project forecast (docs section "Project Cash Flow").
 */
async function getProjectForecast(projectId, params = {}) {
  const consolidated = await getConsolidatedForecast({ ...params, project: projectId });
  const [project] = await Project.find({ _id: projectId }).select('_id projectNumber name contractValue customer status').lean();
  return { project: project || null, ...consolidated };
}

module.exports = {
  getConsolidatedForecast,
  getProjectForecast,
  getCustomerInflowObligations,
  getVendorOutflowObligations,
  getOpeningCashBalance,
};
