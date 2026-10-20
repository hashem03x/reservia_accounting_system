const ApiError = require('../../utils/apiError');
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
