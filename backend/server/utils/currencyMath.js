// Currency conversion math - the ONE place the exchange-rate convention is applied, so every
// caller (Currency Manager, Journal Entries, tests) converts the same way.
//
// Base (functional/reporting) currency: EGP.
//
// Convention for a Currency's configured rate (`unitsPerBase`):
//
//     1 EGP = unitsPerBase units of the foreign currency
//
//   e.g. USD with unitsPerBase = 0.02  ->  1 EGP = 0.02 USD, and the inverse 1 USD = 1 / 0.02 = 50 EGP.
//
// Converting a transaction-currency amount to EGP therefore DIVIDES by unitsPerBase:
//     EGP amount = foreign amount / unitsPerBase        (100 USD / 0.02 = 5,000 EGP)
//
// Calculations always use the stored full-precision rate - never a rounded display value. Only the
// resulting money amount is rounded, to the ledger's existing 2-decimal precision (journalEntryModel.js#round2).
//
// NOTE - the older per-line `JournalLine.exchangeRate` field (written by the accounting CSV import)
// uses the OPPOSITE direction (EGP per 1 foreign unit, i.e. `basePerUnit` below). Use
// `basePerUnit()` whenever that legacy field has to be filled, never the raw `unitsPerBase`.

const BASE_CURRENCY_CODE = 'EGP';

// Precision of a stored rate. Generous enough for currencies with a very small or very large value
// against EGP (e.g. 1 EGP = 0.00001234 BTC-like values, or 1 EGP = 1,500 IDR-like values).
const RATE_MAX_DECIMALS = 10;

const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;

/** True when `rate` is a usable exchange rate: a finite number strictly greater than zero. */
function isValidRate(rate) {
  return typeof rate === 'number' && Number.isFinite(rate) && rate > 0;
}

/** Parses a client-supplied rate (number or numeric string) - returns null when it is not a valid rate. */
function parseRate(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  return isValidRate(n) ? n : null;
}

/** The inverse rate: how many EGP one unit of the foreign currency is worth (1 / unitsPerBase). */
function basePerUnit(unitsPerBase) {
  if (!isValidRate(unitsPerBase)) throw new Error('Exchange rate must be a finite number greater than zero.');
  return 1 / unitsPerBase;
}

/** Converts a transaction-currency amount to EGP, rounded to the ledger's 2-decimal precision. */
function toBaseAmount(amount, unitsPerBase) {
  if (!isValidRate(unitsPerBase)) throw new Error('Exchange rate must be a finite number greater than zero.');
  const value = Number(amount) || 0;
  return round2(value / unitsPerBase);
}

/**
 * Converts every line's transaction-currency debit/credit to EGP.
 *
 * Each line is rounded on its own, so N lines that balance in the transaction currency can end up a
 * few hundredths apart in EGP (e.g. 3 x 33.33 vs 99.99 at an awkward rate). Ledger rule 1 (debit ==
 * credit, every status) must hold in EGP, so that rounding residue - and only that - is absorbed by
 * the single largest line on the heavier side. A residue larger than one cent per line can never
 * come from rounding, so it is rejected instead of being silently "fixed".
 *
 * @param {Array<{debit:number, credit:number}>} lines - amounts in the transaction currency
 * @returns {Array<{debit:number, credit:number}>} the same lines' EGP amounts, in the same order
 */
function convertLinesToBase(lines, unitsPerBase) {
  const converted = lines.map(line => ({ debit: toBaseAmount(line.debit, unitsPerBase), credit: toBaseAmount(line.credit, unitsPerBase) }));
  const totalDebit = round2(converted.reduce((s, l) => s + l.debit, 0));
  const totalCredit = round2(converted.reduce((s, l) => s + l.credit, 0));
  const residue = round2(totalDebit - totalCredit);
  if (residue === 0) return converted;

  if (Math.abs(residue) > 0.01 * lines.length) {
    throw new Error('Journal entry is not balanced. Total debit must equal total credit.');
  }
  const side = residue > 0 ? 'debit' : 'credit';
  let target = -1;
  converted.forEach((l, i) => {
    if (l[side] > 0 && (target === -1 || l[side] > converted[target][side])) target = i;
  });
  converted[target][side] = round2(converted[target][side] - Math.abs(residue));
  return converted;
}

module.exports = { BASE_CURRENCY_CODE, RATE_MAX_DECIMALS, round2, isValidRate, parseRate, basePerUnit, toBaseAmount, convertLinesToBase };
