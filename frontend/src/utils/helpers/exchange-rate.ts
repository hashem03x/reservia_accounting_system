// Currency Management - the frontend half of backend's utils/exchangeRate.js. Two conventions:
//
//   1. Currency.rate (what a user types into the Currency Management form) - units of the
//      foreign currency per 1 EGP, e.g. USD 0.02 ("1 EGP = 0.02 USD").
//   2. JournalLine.exchangeRate (what a Journal Entry line actually stores) - EGP per 1 unit of
//      the foreign currency, e.g. USD 50 ("1 USD = 50 EGP") - predates Currency Management.
//
// `toLineRate`/`toCurrencyRate` are exact inverses and the only sanctioned way to move between
// them - never send a Currency's `rate` straight onto a Journal Entry line.
const RATE_PRECISION = 6;
const RATE_FACTOR = 10 ** RATE_PRECISION;

export function roundRate(value: number): number {
  return Math.round((value + Number.EPSILON) * RATE_FACTOR) / RATE_FACTOR;
}

export function isValidRate(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

export function inverseRate(rate: number): number {
  if (!isValidRate(rate)) return 0;
  return roundRate(1 / rate);
}

/** Currency.rate (foreign per 1 EGP) -> JournalLine.exchangeRate (EGP per 1 foreign unit). */
export function toLineRate(currencyRate: number): number {
  return inverseRate(currencyRate);
}

/** EGP equivalent of a transaction-currency amount, using the line's own exchangeRate (EGP per unit). */
export function egpEquivalent(transactionAmount: number, lineExchangeRate: number): number {
  const rate = lineExchangeRate || 1;
  return Math.round((transactionAmount * rate + Number.EPSILON) * 100) / 100;
}
