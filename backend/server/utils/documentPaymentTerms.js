/**
 * Document payment terms - the contractual payment schedule of ONE document: a Purchase Order
 * (vendor payment terms, measured from the PO issue date) or a Project (customer payment terms,
 * measured from the project start date). Pure, DB-free - shared by the Mongoose schemas
 * (models/shared/paymentTermsSchema.js), the request validators and the cash-flow forecast, and
 * mirrored on the frontend by frontend/src/utils/helpers/document-payment-terms.ts.
 *
 * This is the document's own terms, separate from (and never rewriting) a vendor's default
 * `paymentTermsConfig` (utils/paymentTermsConfig.js) or a Purchase Invoice's snapshotted
 * `paymentSchedule` (utils/helpers/paymentSchedule.js). A schedule is CONTRACTUAL only: it never
 * creates a payment, never marks anything paid and never posts a journal entry.
 *
 * Shape (`terms`):
 *   { mode: 'immediate' }                                  100% due on the issue date
 *   { mode: 'lump_sum', lumpSumDueDate: Date }             100% due on that date
 *   { mode: 'installments', installments: [
 *       { description, basis: 'percentage', percentage, tenorDays },
 *       { description, basis: 'amount', amount, tenorDays }, ... ] }
 *
 * Calculation basis: a 'percentage' row is that percentage of the document value; an 'amount' row
 * is a fixed amount. Each row is due `tenorDays` days after the issue date. Together the rows may
 * allocate LESS than the document value (the rest is shown as unallocated), never more: the
 * allocated amount can never exceed the value, nor the allocated percentage 100%.
 *
 * Rounding: every row amount is rounded to the cent (round half away from zero). When EVERY row is
 * a percentage and they total exactly 100%, the last row absorbs the rounding remainder so the
 * schedule reconciles to the document value exactly. A schedule that allocates less than 100% is
 * never adjusted - its unallocated remainder is reported as such.
 *
 * When the document value changes, percentage rows are recalculated from the new value; amount
 * rows keep their fixed amount (and the schedule is refused if they now exceed the value).
 */

const PaymentTermModes = ['immediate', 'lump_sum', 'installments'];
const InstallmentBases = ['percentage', 'amount'];
const MAX_INSTALLMENTS = 60;
const MAX_TENOR_DAYS = 3650;
const PERCENT_TOLERANCE = 0.01;
const AMOUNT_TOLERANCE = 0.005;

const round2 = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const round4 = value => Math.round((Number(value) + Number.EPSILON) * 10000) / 10000;
const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDayUtc(date) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function addDays(date, days) {
  const d = startOfDayUtc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

const isFiniteNumber = v => typeof v === 'number' && Number.isFinite(v);
const toNumber = v => (v === '' || v === null || v === undefined ? NaN : Number(v));

/**
 * Error message for an invalid `terms`, or null. `total` (the document value) is needed to check
 * amount rows; `issueDate` to check a lump-sum due date. `terms` null/undefined = not set (valid).
 */
function validateDocumentPaymentTerms(terms, { total, issueDate } = {}) {
  if (terms == null) return null;
  if (typeof terms !== 'object') return 'Payment terms must be an object.';
  if (!PaymentTermModes.includes(terms.mode)) return 'Payment terms must be "immediate", "lump_sum" or "installments".';

  if (terms.mode === 'immediate') {
    if (Array.isArray(terms.installments) && terms.installments.length) return 'Immediate payment has no installments.';
    return null;
  }

  if (terms.mode === 'lump_sum') {
    if (!terms.lumpSumDueDate || Number.isNaN(new Date(terms.lumpSumDueDate).getTime())) return 'A lump-sum payment requires a valid due date.';
    if (issueDate && startOfDayUtc(terms.lumpSumDueDate) < startOfDayUtc(issueDate)) return 'The lump-sum due date cannot be before the issue date.';
    if (Array.isArray(terms.installments) && terms.installments.length) return 'A lump-sum payment has no installments.';
    return null;
  }

  // installments
  const rows = terms.installments;
  if (!Array.isArray(rows) || rows.length === 0) return 'Installment payment terms need at least one installment.';
  if (rows.length > MAX_INSTALLMENTS) return `At most ${MAX_INSTALLMENTS} installments are allowed.`;
  const value = toNumber(total);

  let percent = 0;
  let amount = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i] || {};
    const label = `Installment ${i + 1}`;
    const description = typeof row.description === 'string' ? row.description.trim() : '';
    if (!description) return `${label}: a description is required.`;
    if (description.length > 200) return `${label}: the description cannot exceed 200 characters.`;
    if (!InstallmentBases.includes(row.basis)) return `${label}: choose a percentage or a fixed amount.`;
    const tenor = toNumber(row.tenorDays);
    if (!Number.isInteger(tenor) || tenor < 0 || tenor > MAX_TENOR_DAYS) return `${label}: tenor must be a whole number of days between 0 and ${MAX_TENOR_DAYS}.`;
    if (row.basis === 'percentage') {
      const p = toNumber(row.percentage);
      if (!isFiniteNumber(p) || p <= 0 || p > 100) return `${label}: the percentage must be greater than 0 and at most 100.`;
      percent += p;
      if (isFiniteNumber(value)) amount += round2((value * p) / 100);
    } else {
      const a = toNumber(row.amount);
      if (!isFiniteNumber(a) || a <= 0) return `${label}: the amount must be greater than 0.`;
      amount += round2(a);
      if (!isFiniteNumber(value) || value <= 0) return `${label}: a fixed amount needs the document value to be known first.`;
      percent += (a / value) * 100;
    }
  }

  if (percent > 100 + PERCENT_TOLERANCE) return `The installments allocate ${round2(percent)}% - the total cannot exceed 100%.`;
  if (isFiniteNumber(value) && amount > value + AMOUNT_TOLERANCE) {
    return `The installments allocate ${round2(amount)} - more than the total value of ${round2(value)}.`;
  }
  return null;
}

/**
 * The concrete schedule: rows with amount, percentage and due date, plus the allocated and
 * unallocated totals. Assumes `terms` passed validateDocumentPaymentTerms. `total` may be 0/unknown
 * (then percentage rows have no amount yet).
 */
function computeDocumentPaymentSchedule(terms, { total, issueDate } = {}) {
  const value = isFiniteNumber(toNumber(total)) ? round2(toNumber(total)) : 0;
  const start = issueDate ? startOfDayUtc(issueDate) : null;
  const dueOn = days => (start ? addDays(start, days) : null);
  const result = rows => {
    const allocatedAmount = round2(rows.reduce((s, r) => s + (r.amount || 0), 0));
    const allocatedPercentage = round4(rows.reduce((s, r) => s + (r.percentage || 0), 0));
    return { rows, allocatedAmount, allocatedPercentage, unallocatedAmount: round2(Math.max(0, value - allocatedAmount)), total: value };
  };

  if (!terms || !terms.mode) return result([]);

  if (terms.mode === 'immediate') {
    return result([{ description: 'Immediate payment', basis: 'percentage', percentage: 100, amount: value, tenorDays: 0, dueDate: start }]);
  }
  if (terms.mode === 'lump_sum') {
    const due = startOfDayUtc(terms.lumpSumDueDate);
    const tenorDays = start ? Math.max(0, Math.round((due - start) / DAY_MS)) : null;
    return result([{ description: 'Lump sum (100%)', basis: 'percentage', percentage: 100, amount: value, tenorDays, dueDate: due }]);
  }

  const rows = (terms.installments || []).map(row => {
    const tenorDays = toNumber(row.tenorDays);
    if (row.basis === 'amount') {
      const amount = round2(toNumber(row.amount));
      return { description: row.description.trim(), basis: 'amount', amount, percentage: value > 0 ? round4((amount / value) * 100) : 0, tenorDays, dueDate: dueOn(tenorDays) };
    }
    const percentage = toNumber(row.percentage);
    return { description: row.description.trim(), basis: 'percentage', percentage, amount: round2((value * percentage) / 100), tenorDays, dueDate: dueOn(tenorDays) };
  });

  // Exactly 100% in percentages only: the last row absorbs the rounding so the schedule reconciles.
  const allPercent = rows.length > 0 && rows.every(r => r.basis === 'percentage');
  const percentTotal = rows.reduce((s, r) => s + r.percentage, 0);
  if (allPercent && Math.abs(percentTotal - 100) <= PERCENT_TOLERANCE) {
    const others = rows.slice(0, -1).reduce((s, r) => s + r.amount, 0);
    rows[rows.length - 1].amount = round2(value - others);
  }
  return result(rows);
}

/**
 * A vendor's default `paymentTermsConfig` (utils/paymentTermsConfig.js) expressed as document
 * terms - used when a Purchase Order is created without its own terms, so it starts from the
 * vendor's defaults (the same "snapshot at creation" rule as Purchase Invoices).
 */
function termsFromVendorConfig(config, issueDate) {
  if (!config || !config.kind) return { mode: 'immediate' };
  if (config.kind === 'lump_sum') {
    const days = config.lumpSum?.timing === 'deferred' ? Number(config.lumpSum.durationDays) || 0 : 0;
    return days > 0 ? { mode: 'lump_sum', lumpSumDueDate: addDays(issueDate || new Date(), days) } : { mode: 'immediate' };
  }
  const installments = (config.installments || []).map((row, i) => ({
    description: `Installment ${i + 1}`,
    basis: 'percentage',
    percentage: Number(row.percentage),
    tenorDays: Number(row.durationDays) || 0,
  }));
  return installments.length ? { mode: 'installments', installments } : { mode: 'immediate' };
}

/** Plain, normalized terms from a request body (unknown fields dropped, numbers parsed). */
function normalizeDocumentPaymentTerms(input) {
  if (input == null || input === '') return null;
  if (typeof input !== 'object') return input; // let validation report it
  if (input.mode === 'immediate') return { mode: 'immediate', installments: [] };
  if (input.mode === 'lump_sum') return { mode: 'lump_sum', lumpSumDueDate: input.lumpSumDueDate ? new Date(input.lumpSumDueDate) : null, installments: [] };
  return {
    mode: input.mode,
    lumpSumDueDate: null,
    installments: Array.isArray(input.installments)
      ? input.installments.map(row => ({
          description: typeof row?.description === 'string' ? row.description.trim() : row?.description,
          basis: row?.basis,
          percentage: row?.basis === 'percentage' ? toNumber(row.percentage) : null,
          amount: row?.basis === 'amount' ? toNumber(row.amount) : null,
          tenorDays: toNumber(row?.tenorDays),
        }))
      : input.installments,
  };
}

module.exports = {
  PaymentTermModes,
  InstallmentBases,
  MAX_INSTALLMENTS,
  validateDocumentPaymentTerms,
  computeDocumentPaymentSchedule,
  termsFromVendorConfig,
  normalizeDocumentPaymentTerms,
  round2,
};
