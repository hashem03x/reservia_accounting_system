// Document payment terms (Purchase Order vendor terms, Project customer terms) - the frontend mirror
// of backend/server/utils/documentPaymentTerms.js, so the form can show the schedule, the allocated
// and unallocated totals and every error live. The backend re-validates on save (it is the rule);
// keep both in step.
//
// Calculation basis: a "percentage" installment is that % of the document value, an "amount" one a
// fixed amount; each is due `tenorDays` after the issue date. Rows may allocate LESS than the value
// (the rest is unallocated), never more. Rounding: amounts to the cent; when every row is a
// percentage and they total exactly 100%, the last row absorbs the rounding remainder.

export type PaymentTermMode = "immediate" | "lump_sum" | "installments";
export type InstallmentBasis = "percentage" | "amount";

export interface InstallmentInput {
  description: string;
  basis: InstallmentBasis;
  percentage?: number | string | null;
  amount?: number | string | null;
  tenorDays: number | string;
}

export interface DocumentPaymentTerms {
  mode: PaymentTermMode;
  lumpSumDueDate?: string | Date | null;
  installments?: InstallmentInput[];
}

export interface ScheduleRow {
  description: string;
  basis: InstallmentBasis;
  percentage: number;
  amount: number;
  tenorDays: number | null;
  dueDate: Date | null;
}

export interface PaymentSchedule {
  rows: ScheduleRow[];
  allocatedAmount: number;
  allocatedPercentage: number;
  unallocatedAmount: number;
  total: number;
}

export const MAX_INSTALLMENTS = 60;
const MAX_TENOR_DAYS = 3650;
const PERCENT_TOLERANCE = 0.01;
const AMOUNT_TOLERANCE = 0.005;
const DAY_MS = 24 * 60 * 60 * 1000;

export const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const round4 = (v: number) => Math.round((v + Number.EPSILON) * 10000) / 10000;
const toNumber = (v: unknown) => (v === "" || v === null || v === undefined ? NaN : Number(v));
const isFiniteNumber = (v: number) => typeof v === "number" && Number.isFinite(v);

function startOfDayUtc(date: string | Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export function addDays(date: string | Date, days: number): Date {
  const d = startOfDayUtc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/** An empty installment row, for the "number of installments" control. */
export const emptyInstallment = (index: number): InstallmentInput => ({ description: `Installment ${index + 1}`, basis: "percentage", percentage: "", tenorDays: 0 });

/** Resizes the installment list to `count` rows, keeping the rows already entered. */
export function resizeInstallments(rows: InstallmentInput[], count: number): InstallmentInput[] {
  const n = Math.max(0, Math.min(MAX_INSTALLMENTS, Math.floor(count) || 0));
  return Array.from({ length: n }, (_, i) => rows[i] ?? emptyInstallment(i));
}

/** Error message for invalid terms, or null - same rules and messages as the backend. */
export function validateDocumentPaymentTerms(terms: DocumentPaymentTerms | null | undefined, { total, issueDate }: { total?: number | null; issueDate?: string | Date | null } = {}): string | null {
  if (terms == null) return null;
  if (!["immediate", "lump_sum", "installments"].includes(terms.mode)) return 'Payment terms must be "immediate", "lump_sum" or "installments".';
  if (terms.mode === "immediate") return null;
  if (terms.mode === "lump_sum") {
    if (!terms.lumpSumDueDate || Number.isNaN(new Date(terms.lumpSumDueDate).getTime())) return "A lump-sum payment requires a valid due date.";
    if (issueDate && startOfDayUtc(terms.lumpSumDueDate) < startOfDayUtc(issueDate)) return "The lump-sum due date cannot be before the issue date.";
    return null;
  }
  const rows = terms.installments ?? [];
  if (rows.length === 0) return "Installment payment terms need at least one installment.";
  if (rows.length > MAX_INSTALLMENTS) return `At most ${MAX_INSTALLMENTS} installments are allowed.`;
  const value = toNumber(total);
  let percent = 0;
  let amount = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const label = `Installment ${i + 1}`;
    const description = (row.description ?? "").trim();
    if (!description) return `${label}: a description is required.`;
    if (description.length > 200) return `${label}: the description cannot exceed 200 characters.`;
    const tenor = toNumber(row.tenorDays);
    if (!Number.isInteger(tenor) || tenor < 0 || tenor > MAX_TENOR_DAYS) return `${label}: tenor must be a whole number of days between 0 and ${MAX_TENOR_DAYS}.`;
    if (row.basis === "percentage") {
      const p = toNumber(row.percentage);
      if (!isFiniteNumber(p) || p <= 0 || p > 100) return `${label}: the percentage must be greater than 0 and at most 100.`;
      percent += p;
      if (isFiniteNumber(value)) amount += round2((value * p) / 100);
    } else if (row.basis === "amount") {
      const a = toNumber(row.amount);
      if (!isFiniteNumber(a) || a <= 0) return `${label}: the amount must be greater than 0.`;
      if (!isFiniteNumber(value) || value <= 0) return `${label}: a fixed amount needs the document value to be known first.`;
      amount += round2(a);
      percent += (a / value) * 100;
    } else {
      return `${label}: choose a percentage or a fixed amount.`;
    }
  }
  if (percent > 100 + PERCENT_TOLERANCE) return `The installments allocate ${round2(percent)}% - the total cannot exceed 100%.`;
  if (isFiniteNumber(value) && amount > value + AMOUNT_TOLERANCE) return `The installments allocate ${round2(amount)} - more than the total value of ${round2(value)}.`;
  return null;
}

/** The concrete schedule for display. Rows that are not complete yet count as 0. */
export function computeDocumentPaymentSchedule(terms: DocumentPaymentTerms | null | undefined, { total, issueDate }: { total?: number | null; issueDate?: string | Date | null } = {}): PaymentSchedule {
  const value = isFiniteNumber(toNumber(total)) ? round2(toNumber(total)) : 0;
  const start = issueDate ? startOfDayUtc(issueDate) : null;
  const finish = (rows: ScheduleRow[]): PaymentSchedule => {
    const allocatedAmount = round2(rows.reduce((s, r) => s + (r.amount || 0), 0));
    return {
      rows,
      allocatedAmount,
      allocatedPercentage: round4(rows.reduce((s, r) => s + (r.percentage || 0), 0)),
      unallocatedAmount: round2(Math.max(0, value - allocatedAmount)),
      total: value,
    };
  };
  if (!terms) return finish([]);
  if (terms.mode === "immediate") return finish([{ description: "Immediate payment", basis: "percentage", percentage: 100, amount: value, tenorDays: 0, dueDate: start }]);
  if (terms.mode === "lump_sum") {
    const due = terms.lumpSumDueDate ? startOfDayUtc(terms.lumpSumDueDate) : null;
    const tenorDays = start && due ? Math.max(0, Math.round((due.getTime() - start.getTime()) / DAY_MS)) : null;
    return finish([{ description: "Lump sum (100%)", basis: "percentage", percentage: 100, amount: value, tenorDays, dueDate: due }]);
  }
  const rows: ScheduleRow[] = (terms.installments ?? []).map((row) => {
    const tenor = toNumber(row.tenorDays);
    const tenorDays = Number.isInteger(tenor) && tenor >= 0 ? tenor : null;
    const dueDate = start && tenorDays !== null ? addDays(start, tenorDays) : null;
    if (row.basis === "amount") {
      const a = toNumber(row.amount);
      const amount = isFiniteNumber(a) && a > 0 ? round2(a) : 0;
      return { description: (row.description ?? "").trim(), basis: "amount", amount, percentage: value > 0 ? round4((amount / value) * 100) : 0, tenorDays, dueDate };
    }
    const p = toNumber(row.percentage);
    const percentage = isFiniteNumber(p) && p > 0 ? p : 0;
    return { description: (row.description ?? "").trim(), basis: "percentage", percentage, amount: round2((value * percentage) / 100), tenorDays, dueDate };
  });
  const allPercent = rows.length > 0 && rows.every((r) => r.basis === "percentage");
  const percentTotal = rows.reduce((s, r) => s + r.percentage, 0);
  if (allPercent && Math.abs(percentTotal - 100) <= PERCENT_TOLERANCE) {
    const others = rows.slice(0, -1).reduce((s, r) => s + r.amount, 0);
    rows[rows.length - 1].amount = round2(value - others);
  }
  return finish(rows);
}

/** The terms as the API expects them (numbers parsed, unused fields dropped). */
export function toPaymentTermsPayload(terms: DocumentPaymentTerms): DocumentPaymentTerms {
  if (terms.mode === "immediate") return { mode: "immediate" };
  if (terms.mode === "lump_sum") return { mode: "lump_sum", lumpSumDueDate: terms.lumpSumDueDate ?? null };
  return {
    mode: "installments",
    installments: (terms.installments ?? []).map((row) => ({
      description: (row.description ?? "").trim(),
      basis: row.basis,
      ...(row.basis === "percentage" ? { percentage: Number(row.percentage) } : { amount: Number(row.amount) }),
      tenorDays: Number(row.tenorDays),
    })),
  };
}
