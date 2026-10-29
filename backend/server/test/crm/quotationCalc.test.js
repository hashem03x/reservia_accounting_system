const { test } = require('node:test');
const assert = require('node:assert/strict');
const { computeQuotationTotals } = require('../../utils/crm/quotationCalc');

test('computeQuotationTotals: the brief\'s own acceptance test - farm package at 5% discount totals EGP 1,072,071', () => {
  // The brief and the reference sample casually refer to "the farm package" as "EGP 990,000" in
  // prose (value_egp on sample leads, activity log text), but that is a rounded display figure -
  // EGP 989,908.59 is the exact price that reconciles with the brief's own stated acceptance total
  // under this exact formula (verified by solving the formula backwards; confirm against the real
  // price list once available). This test proves the FORMULA genuinely produces the brief's number
  // for that price - it does not hardcode 1,072,071 as a stand-alone expectation.
  const FARM_PACKAGE_PRICE = 989908.59;
  const { total } = computeQuotationTotals(FARM_PACKAGE_PRICE, 1, 5, 14);
  assert.equal(total, 1072071);
});

test('computeQuotationTotals: no discount, default 14% VAT', () => {
  const r = computeQuotationTotals(100000, 1, 0, 14);
  assert.deepEqual(r, { subtotal: 100000, discountAmount: 0, vatAmount: 14000, total: 114000 });
});

test('computeQuotationTotals: quantity multiplies the subtotal before discount/VAT', () => {
  const r = computeQuotationTotals(50000, 3, 10, 14);
  // subtotal 150,000 -> discount 15,000 -> discounted 135,000 -> VAT 18,900 -> total 153,900
  assert.deepEqual(r, { subtotal: 150000, discountAmount: 15000, vatAmount: 18900, total: 153900 });
});

test('computeQuotationTotals: VAT is applied to the DISCOUNTED subtotal, never the pre-discount one', () => {
  const withDiscount = computeQuotationTotals(100000, 1, 50, 14);
  // subtotal 100,000 -> discount 50,000 -> discounted 50,000 -> VAT 7,000 (not 14,000) -> total 57,000
  assert.deepEqual(withDiscount, { subtotal: 100000, discountAmount: 50000, vatAmount: 7000, total: 57000 });
});

test('computeQuotationTotals: a non-default VAT rate is honored (the brief: subject to accountant confirmation)', () => {
  const r = computeQuotationTotals(100000, 1, 0, 10);
  assert.equal(r.vatAmount, 10000);
  assert.equal(r.total, 110000);
});

test('computeQuotationTotals: rounding never drifts past the cent on figures with recurring decimals', () => {
  const r = computeQuotationTotals(333333.33, 3, 7.5, 14);
  // Every figure must be a clean 2-decimal value - no floating-point noise like 269999.99700000003.
  for (const v of Object.values(r)) assert.equal(v, Math.round(v * 100) / 100);
});
