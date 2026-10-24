/**
 * Vendor Payment Terms - Lump Sum and Installments (docs section "Vendor Payment Terms" ->
 * "Accounting and procurement integration"). Converts a vendor's configured `paymentTermsConfig`
 * (see utils/paymentTermsConfig.js) into a concrete payment schedule for ONE document total -
 * pure function, backend-only, no DB access, so it is safe to call at document-creation time and
 * snapshot the result directly onto that document (purchaseOrder.js's `paymentSchedule` field).
 *
 * Snapshotting (not re-deriving on every read) is deliberate: a vendor's terms can change after
 * this document was created, and historical/existing documents must keep the schedule that was
 * actually in effect when they were created - the exact rule "later changes to vendor defaults do
 * not silently rewrite historical or existing document schedules".
 *
 * Rounding policy (documented here, the one place amounts are computed): each installment amount
 * is `round2(total * percentage / 100)`; the LAST installment absorbs whatever rounding remainder
 * is left (`total - sum of all other installments' rounded amounts`), so the schedule always
 * reconciles EXACTLY to `total` to the cent, never off by a rounding cent on the final row.
 */
// Same day-addition approach as dueDate.js#addDays (setUTCDate correctly rolls over month/year
// boundaries) - kept local rather than imported to avoid coupling this pure helper to that file.
function addDays(date, days) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * @param {object|null|undefined} paymentTermsConfig - see utils/paymentTermsConfig.js
 * @param {Date|string} documentDate
 * @param {number} total - the document's full payable amount (e.g. grandTotal)
 * @returns {Array<{ durationDays: number, dueDate: Date, percentage: number, amount: number }>}
 */
function buildPaymentSchedule(paymentTermsConfig, documentDate, total) {
  const safeTotal = Number(total) || 0;

  if (!paymentTermsConfig || paymentTermsConfig.kind === 'lump_sum') {
    const durationDays = paymentTermsConfig?.kind === 'lump_sum' && paymentTermsConfig.lumpSum?.timing === 'deferred' ? Number(paymentTermsConfig.lumpSum.durationDays) || 0 : 0;
    return [{ durationDays, dueDate: addDays(documentDate, durationDays), percentage: 100, amount: round2(safeTotal) }];
  }

  // kind === 'installments' - each installment's days count from the previous installment (the
  // first from the document date); a row's durationDays is its total days from the document date.
  const installments = paymentTermsConfig.installments || [];
  let elapsedDays = 0;
  const rows = installments.map(installment => {
    elapsedDays += Number(installment.durationDays) || 0;
    return {
      durationDays: elapsedDays,
      dueDate: addDays(documentDate, elapsedDays),
      percentage: installment.percentage,
      amount: round2((safeTotal * installment.percentage) / 100),
    };
  });

  if (rows.length > 0) {
    const sumExceptLast = rows.slice(0, -1).reduce((sum, row) => sum + row.amount, 0);
    rows[rows.length - 1].amount = round2(safeTotal - sumExceptLast);
  }

  return rows;
}

module.exports = { buildPaymentSchedule, round2 };
