const ApiError = require('../../utils/apiError');
<<<<<<< HEAD
const Currency = require('../../models/accounting/currencyModel');
const { toLineRate, isValidRate, egpEquivalent } = require('../../utils/exchangeRate');

// Currency propagation for Journal Entry lines - mirrors journalEntryProjectService.js's
// applyEntryProjectToLines exactly: one place every JE builder (today, only the manual Journal
// Entry create/update endpoints - the automatic accounting engine never sets a currency) uses to
// give every line of an entry the SAME currency and exchange rate, and to compute each line's EGP
// debit/credit SERVER-SIDE from the transaction-currency amount it was given - a client-sent EGP
// amount for a foreign-currency line is never trusted, the same "server always recomputes money
// math" rule computeOrderTotals (utils/orderTotals.js) already follows for order totals.

/**
 * Returns `lines` with the entry's currency/exchange rate applied to every line, and each line's
 * EGP debit/credit computed from its transaction-currency amount at that rate.
 *
 *   - No currencyCode, or 'EGP': every line is forced back to the plain EGP state (currency:null,
 *     exchangeRate:null, transactionDebit/Credit:null) regardless of what was sent - debit/credit
 *     are used exactly as given, exactly like every Journal Entry before this feature existed.
 *   - A real, ACTIVE foreign currency: looks up its current master rate (unless `exchangeRate` is
 *     given, an authorized user's transaction-specific override - validated, never written back to
 *     the Currency master). Every line must give a transactionDebit or transactionCredit (the
 *     amount in that currency); debit/credit are computed from it, never taken from the request.
 */
async function applyEntryCurrencyToLines({ currencyCode, exchangeRate, lines, session }) {
  const code = (currencyCode || 'EGP').toUpperCase();

  if (code === 'EGP') {
    return (lines || []).map(line => {
      const plain = typeof line?.toObject === 'function' ? line.toObject() : { ...line };
      return { ...plain, currency: null, exchangeRate: null, transactionDebit: null, transactionCredit: null };
    });
  }

  const currency = await Currency.findOne({ code }).session(session || null);
  if (!currency) throw new ApiError(`Currency "${code}" does not exist.`, 400);
  if (!currency.isActive) throw new ApiError(`Currency "${code}" is inactive and cannot be used on a new journal entry.`, 400);

  let rate;
  if (exchangeRate != null) {
    if (!isValidRate(Number(exchangeRate))) throw new ApiError('Exchange rate must be a finite number greater than zero.', 400);
    rate = Number(exchangeRate); // the transaction-specific override - stored on the entry, never on the Currency master.
  } else {
    rate = toLineRate(currency.rate); // the currency's current configured rate, converted to this entry's convention.
  }

  const result = [];
  (lines || []).forEach((line, index) => {
    const plain = typeof line?.toObject === 'function' ? line.toObject() : { ...line };
    const hasTransactionDebit = plain.transactionDebit != null && Number(plain.transactionDebit) > 0;
    const hasTransactionCredit = plain.transactionCredit != null && Number(plain.transactionCredit) > 0;
    if (!hasTransactionDebit && !hasTransactionCredit) {
      throw new ApiError(`Journal line ${index + 1}: a transaction-currency debit or credit amount is required for a ${code} line.`, 400);
    }
    result.push({
      ...plain,
      currency: code,
      exchangeRate: rate,
      transactionDebit: hasTransactionDebit ? Number(plain.transactionDebit) : null,
      transactionCredit: hasTransactionCredit ? Number(plain.transactionCredit) : null,
      debit: hasTransactionDebit ? egpEquivalent(plain.transactionDebit, rate) : 0,
      credit: hasTransactionCredit ? egpEquivalent(plain.transactionCredit, rate) : 0,
    });
  });
  return result;
}

module.exports = { applyEntryCurrencyToLines };
=======
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
>>>>>>> origin/main
