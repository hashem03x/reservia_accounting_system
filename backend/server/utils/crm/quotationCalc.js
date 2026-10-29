// Quotation line-item totals (Reservia CRM Developer Brief, section 4E / acceptance test): "Farm
// package at 5% discount totals EGP 1,072,071." Pure, DB-free - ported from the supplied reference
// sample's `qTotals()` exactly, including its round-to-the-cent-at-every-step order (subtotal,
// then the discount amount, then VAT on the discounted subtotal, then the final total) - the brief
// says to verify the underlying price and rounding logic, not hardcode the expected result, so
// this is the one place that logic lives, shared by the quotation service and this file's own test.
//
// VAT defaults to 14% per the brief ("VAT on quotations defaults to 14%; Ahmed confirms the
// treatment with the accountant before the first real quote") - callers may still pass a different
// rate once that confirmation changes it; nothing here hardcodes 14 as unconditional.

const DEFAULT_VAT_PERCENT = 14;

const round2 = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

/**
 * @param {number} unitPrice
 * @param {number} quantity
 * @param {number} discountPercent - 0-100
 * @param {number} [vatPercent] - defaults to 14
 * @returns {{subtotal: number, discountAmount: number, vatAmount: number, total: number}}
 */
function computeQuotationTotals(unitPrice, quantity, discountPercent, vatPercent = DEFAULT_VAT_PERCENT) {
  const subtotal = round2(unitPrice * quantity);
  const discountAmount = round2(subtotal * (discountPercent / 100));
  const discountedSubtotal = round2(subtotal - discountAmount);
  const vatAmount = round2(discountedSubtotal * (vatPercent / 100));
  const total = round2(discountedSubtotal + vatAmount);
  return { subtotal, discountAmount, vatAmount, total };
}

module.exports = { computeQuotationTotals, round2, DEFAULT_VAT_PERCENT };
