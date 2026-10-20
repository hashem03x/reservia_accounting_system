const { round2 } = require('./orderTotals');

// Currency Management / multi-currency Journal Entries - the one shared place every exchange-rate
// calculation in this feature goes through, so the backend, frontend (via the API) and reports can
// never silently disagree about the math.
//
// TWO rate conventions coexist on purpose, at two different layers, and this module is the only
// place that converts between them:
//
//   1. Currency.rate (models/accounting/currencyModel.js) - the CANONICAL, user-facing
//      representation this feature's spec requires: units of the foreign currency per 1 EGP
//      (e.g. USD 0.02, i.e. "1 EGP = 0.02 USD"). The rate a user actually types into the Currency
//      Management form, and the one shown as "1 EGP = X USD".
//
//   2. JournalEntry.lines.exchangeRate (models/accounting/journalEntryModel.js) - EGP per 1 unit of
//      the foreign currency (e.g. USD 50, i.e. "1 USD = 50 EGP"). This field already existed before
//      Currency Management (added for the accounting CSV import) and every pre-existing
//      calculation that reads it (services/accounting/generalLedgerService.js's running balances,
//      services/reports/generalLedgerReport.js, services/reports/partyReports.js) already assumes
//      this direction. Changing its meaning would silently corrupt every historical entry that
//      already carries a real exchangeRate - so it is deliberately left exactly as it was.
//
// `toLineRate`/`toCurrencyRate` are exact inverses of each other and are the ONLY sanctioned way to
// move a rate between the two conventions - a Journal Entry is never given a Currency's `rate`
// directly.
//
// Rates need more precision than money: EGP 50.5 <-> USD 0.0198019801... would lose real precision
// at 2 decimal places (inverting a 2dp-rounded 0.02 never gets back to 50.5), so rates are rounded
// to RATE_PRECISION decimal places, not round2's 2.
const RATE_PRECISION = 6;
const RATE_FACTOR = 10 ** RATE_PRECISION;

/** Rounds a RATE (not a money amount - use round2 from utils/orderTotals.js for those). */
function roundRate(value) {
  return Math.round((Number(value) + Number.EPSILON) * RATE_FACTOR) / RATE_FACTOR;
}

/** True only for a finite, strictly-positive number - every exchange rate must satisfy this. */
function isValidRate(value) {
  return Number.isFinite(value) && value > 0;
}

/** The exact mathematical inverse of a rate, rounded to RATE_PRECISION decimal places. */
function inverseRate(rate) {
  if (!isValidRate(rate)) throw new Error('Cannot invert a rate that is not a finite, positive number.');
  return roundRate(1 / rate);
}

/** Currency.rate (foreign per 1 EGP) -> JournalEntry.lines.exchangeRate (EGP per 1 foreign unit). */
function toLineRate(currencyRate) {
  return inverseRate(currencyRate);
}

/** JournalEntry.lines.exchangeRate (EGP per 1 foreign unit) -> Currency.rate (foreign per 1 EGP). */
function toCurrencyRate(lineExchangeRate) {
  return inverseRate(lineExchangeRate);
}

/**
 * EGP equivalent of a transaction-currency amount, using the JournalEntry line's own exchangeRate
 * (EGP per 1 foreign unit): `egpAmount = transactionAmount * exchangeRate`. For EGP itself
 * (exchangeRate 1 or null), this is the identity - the transaction amount IS the EGP amount,
 * matching every existing EGP-only entry exactly.
 */
function egpEquivalent(transactionAmount, lineExchangeRate) {
  const rate = lineExchangeRate == null ? 1 : Number(lineExchangeRate);
  return round2(Number(transactionAmount || 0) * rate);
}

/** The transaction-currency amount implied by a stored EGP amount and rate (the inverse of egpEquivalent). */
function transactionAmountFromEgp(egpAmount, lineExchangeRate) {
  const rate = lineExchangeRate == null ? 1 : Number(lineExchangeRate);
  return roundRate(Number(egpAmount || 0) / rate);
}

module.exports = { RATE_PRECISION, roundRate, isValidRate, inverseRate, toLineRate, toCurrencyRate, egpEquivalent, transactionAmountFromEgp };
