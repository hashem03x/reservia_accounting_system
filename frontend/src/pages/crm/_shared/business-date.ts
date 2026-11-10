// Reservia CRM - Cairo business dates in the browser (Change Request 2, item 2). Mirrors
// backend/server/utils/crm/businessDate.js.
//
// A follow-up is a CALENDAR DATE ("2026-11-12"), not an instant. `new Date("2026-11-12")` means
// UTC midnight - shown as "Nov 12, 2:00 AM" in Cairo and as Nov 11 west of UTC, which is the exact
// bug Change Request 2 reported. Every CRM screen formats follow-ups through formatFollowUpDate
// below, which never converts a date-only value through the browser's timezone.
//
// Real instants (created, first reply, stage changes, activities) are formatted in Africa/Cairo
// time with formatCairoDateTime, so every user sees the business's own clock regardless of their
// device timezone.
//
// Pure (no React, no `@/` imports) so it runs under `node --test` (package.json#test:unit).

export const BUSINESS_TIMEZONE = "Africa/Cairo";
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

type DateInput = string | Date | null | undefined;

/** The Cairo calendar day ("YYYY-MM-DD") an instant falls on. */
export function cairoDateOf(instant: string | number | Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(instant));
}

/** Today in Cairo, "YYYY-MM-DD". */
export function cairoToday(now: Date = new Date()): string {
  return cairoDateOf(now);
}

/**
 * Any follow-up value -> "YYYY-MM-DD" or null. A date-only string is returned untouched; a legacy
 * ISO timestamp (an old record, or an old API response) maps to the Cairo day it falls on.
 */
export function toDateOnly(value: DateInput): string | null {
  if (!value) return null;
  if (typeof value === "string" && DATE_ONLY.test(value.trim())) return value.trim();
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : cairoDateOf(d);
}

/**
 * Displays a follow-up date exactly as entered - "12 Nov 2026" for "2026-11-12" - in any browser
 * timezone. The day is formatted in UTC on purpose: the Date built here is UTC midnight of that
 * calendar day, so formatting it in UTC can never move it to a neighbouring day.
 */
export function formatFollowUpDate(value: DateInput, language: string, opts: { withYear?: boolean } = { withYear: true }): string {
  const day = toDateOnly(value);
  if (!day) return "-";
  const [, y, m, d] = day.match(DATE_ONLY)!;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return date.toLocaleDateString(language, { timeZone: "UTC", day: "numeric", month: "short", ...(opts.withYear === false ? {} : { year: "numeric" }) });
}

/** Overdue only once the follow-up DAY has ended in Cairo - a follow-up due today is not overdue. */
export function isFollowUpOverdue(value: DateInput, now: Date = new Date()): boolean {
  const day = toDateOnly(value);
  return !!day && day < cairoToday(now);
}

/** A real instant shown in Cairo time ("12 Nov 2026, 10:39"). */
export function formatCairoDateTime(instant: string | number | Date | null | undefined, language: string): string {
  if (!instant) return "-";
  const d = new Date(instant);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString(language, { timeZone: BUSINESS_TIMEZONE, day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Value for an <input type="date"> - the stored calendar day, never a shifted one. */
export function toDateInputValue(value: DateInput): string {
  return toDateOnly(value) || "";
}
