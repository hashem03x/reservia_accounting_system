const ApiError = require('../../utils/apiError');
const { BASE_CURRENCY_CODE, round2, basePerUnit, convertLinesToBase } = require('../../utils/currencyMath');

// Currency handling for MANUAL journal entry lines (the Journal Entries create/edit endpoints).
//
// A manual entry has ONE transaction currency. The request's line `debit`/`credit` are amounts in
// that currency; this converts them to EGP (the stored `debit`/`credit` every balance and report
// uses) and keeps the original amounts in `currencyDebit`/`currencyCredit`. The currency fields of
// a line are always derived here - any value a client sent for them is discarded.
//
// Rate convention: 1 EGP = unitsPerBase units of the currency (utils/currencyMath.js).

const CURRENCY_LINE_FIELDS = ['currency', 'exchangeRate', 'currencyDebit', 'currencyCredit'];

const stripCurrencyFields = line => {
  const plain = typeof line?.toObject === 'function' ? line.toObject({ depopulate: true }) : { ...line };
  CURRENCY_LINE_FIELDS.forEach(f => delete plain[f]);
  return plain;
};

/**
 * @param {Array} lines - request lines; debit/credit in the transaction currency
 * @param {{code: string, unitsPerBase: number}} currency - resolved by currencyService.resolveEntryCurrency
 * @returns lines ready to persist (debit/credit in EGP)
 */
function applyCurrencyToLines(lines, { code, unitsPerBase }) {
  const plainLines = (lines || []).map(stripCurrencyFields);
  if (!code || code === BASE_CURRENCY_CODE) {
    // EGP: amounts are kept exactly as before this feature existed - only the currency fields are reset.
    return plainLines.map(l => ({ ...l, currency: null, exchangeRate: null, currencyDebit: null, currencyCredit: null }));
  }

  const foreign = plainLines.map(l => ({ debit: round2(Number(l.debit) || 0), credit: round2(Number(l.credit) || 0) }));
  let base;
  try {
    base = convertLinesToBase(foreign, unitsPerBase);
  } catch (err) {
    throw new ApiError(err.message, 400);
  }
  const egpPerUnit = basePerUnit(unitsPerBase);
  return plainLines.map((l, i) => {
    // A non-zero foreign amount that rounds to 0.00 EGP would make the line both-zero, which
    // ledger rules forbid - say so clearly instead of failing on a confusing line error.
    if ((foreign[i].debit > 0 && base[i].debit <= 0) || (foreign[i].credit > 0 && base[i].credit <= 0)) {
      throw new ApiError(`Journal line ${i + 1}: the amount is too small to be recorded in EGP at this exchange rate.`, 400);
    }
    return {
      ...l,
      debit: base[i].debit,
      credit: base[i].credit,
      currencyDebit: foreign[i].debit,
      currencyCredit: foreign[i].credit,
      currency: code,
      // The legacy per-line field keeps its own (import) convention: EGP per 1 unit.
      exchangeRate: egpPerUnit,
    };
  });
}

/**
 * The transaction-currency amounts of already-stored lines - used to re-convert a draft whose lines
 * were not re-sent (e.g. only its currency or rate changed). EGP lines' own amounts are returned.
 */
function storedLinesAsInput(lines) {
  return (lines || []).map(line => {
    const plain = typeof line?.toObject === 'function' ? line.toObject({ depopulate: true }) : { ...line };
    const hasForeign = plain.currencyDebit != null || plain.currencyCredit != null;
    return { ...plain, debit: hasForeign ? plain.currencyDebit || 0 : plain.debit, credit: hasForeign ? plain.currencyCredit || 0 : plain.credit };
  });
}

module.exports = { applyCurrencyToLines, storedLinesAsInput };
