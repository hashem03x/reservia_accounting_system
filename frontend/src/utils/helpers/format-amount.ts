/**
 * "1,000,000 EGP"-style display of a monetary amount the backend returned - the existing
 * `toLocaleString()` + currency convention of the Project screens. Returns "-" for anything that is
 * not a finite number (missing/legacy fields), so the UI never calls a number method on undefined.
 */
export function formatAmount(value: unknown, currency: string): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toLocaleString()} ${currency}` : "-";
}
