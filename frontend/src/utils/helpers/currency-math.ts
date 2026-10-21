// Display-side currency helpers. The backend (utils/currencyMath.js) is the source of truth for
// every stored amount; these mirror its convention only for live previews in forms.
//
// Convention: 1 EGP = unitsPerBase units of the foreign currency.
//   USD @ 0.02  ->  1 EGP = 0.02 USD,  1 USD = 1 / 0.02 = 50 EGP,  100 USD = 5,000 EGP.
// Previews always compute from the full-precision rate, never from a rounded display value.

export const BASE_CURRENCY_CODE = "EGP";

export function isValidRate(rate: unknown): rate is number {
  return typeof rate === "number" && Number.isFinite(rate) && rate > 0;
}

/** 1 unit of the foreign currency in EGP (the inverse rate), or null for an invalid rate. */
export function inverseRate(unitsPerBase: unknown): number | null {
  return isValidRate(unitsPerBase) ? 1 / unitsPerBase : null;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** A transaction-currency amount in EGP, rounded to 2 decimals (the ledger's precision). */
export function toBaseAmount(amount: number, unitsPerBase: number): number | null {
  if (!isValidRate(unitsPerBase)) return null;
  return round2((Number(amount) || 0) / unitsPerBase);
}

/**
 * A rate for display: enough significant digits that small and large rates both stay readable
 * (0.0204 -> "0.0204", 49.01960784 -> "49.019608", 1500 -> "1,500"). Display only - never feed the
 * result back into a calculation.
 */
export function formatRate(rate: number | null | undefined, locale = "en-US"): string {
  if (rate === null || rate === undefined || !Number.isFinite(rate)) return "-";
  const abs = Math.abs(rate);
  const maximumFractionDigits = abs >= 1000 ? 2 : abs >= 1 ? 6 : Math.min(10, 6 - Math.floor(Math.log10(abs)));
  return rate.toLocaleString(locale, { maximumFractionDigits });
}
