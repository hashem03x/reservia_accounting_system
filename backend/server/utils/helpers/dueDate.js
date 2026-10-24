// Due-date calculation from an invoice date + payment terms (docs section "Payment Terms for
// Customers and Vendors" - "Allow invoice due dates to be calculated from the invoice date and
// the applicable payment terms"). Pure function, backend-only (per "keep accounting calculations
// on the backend") - the frontend never computes this itself, only displays what the backend
// returns/stores.
//
// 'Immediate' -> the same date as the invoice (due on receipt).
// 'Net X' -> invoice date + X days.
// 'Custom' -> invoice date + `customDays` (required when terms === 'Custom' - the caller is
// responsible for having validated that, this function trusts its input).
//
// Date arithmetic goes through plain Date day-addition (setUTCDate), which correctly rolls over
// month and year boundaries (e.g. Jan 31 + 30 days -> Mar 2; Dec 15 + 30 days -> Jan 14 of the
// next year) - never hand-rolled month/day math that would need its own leap-year/days-in-month
// handling.
const NET_DAYS_BY_TERM = {
  'Net 15': 15,
  'Net 30': 30,
  'Net 45': 45,
  'Net 60': 60,
  'Net 90': 90,
};

function addDays(date, days) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

/**
 * @param {Date|string} invoiceDate
 * @param {string} paymentTerms - 'Immediate' | 'Net 15' | 'Net 30' | 'Net 45' | 'Net 60' | 'Net 90' | 'Custom'
 * @param {number|null} customDays - only used when paymentTerms === 'Custom'
 * @returns {Date}
 */
function calculateDueDate(invoiceDate, paymentTerms, customDays) {
  const base = new Date(invoiceDate);
  if (paymentTerms === 'Immediate') return base;
  if (paymentTerms === 'Custom') return addDays(base, Number(customDays) || 0);
  const days = NET_DAYS_BY_TERM[paymentTerms];
  if (days == null) return base; // Unknown/missing terms - never invent a date, just don't shift it.
  return addDays(base, days);
}

module.exports = { calculateDueDate, NET_DAYS_BY_TERM };
