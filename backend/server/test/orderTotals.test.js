const { test } = require('node:test');
const assert = require('node:assert/strict');
const { computeOrderTotals, getOrderTotalAmount, orderTotalAmountExpr, ORDER_TOTAL_AMOUNT_EXPR } = require('../utils/orderTotals');

// utils/orderTotals.js is the single canonical order-total calculation shared by the SalesOrder and
// PurchaseOrder models (pre('save')) and every report/dashboard aggregation.

test('Subtotal 100,000 + 14% VAT -> Total Amount 114,000', () => {
  assert.deepEqual(computeOrderTotals({ subtotal: 100000, vatPercentage: 14 }), { subtotal: 100000, vatAmount: 14000, withholdingTaxAmount: 0, total: 114000 });
});

test('VAT + withholding: 100,000 @ 14% VAT, 1% WHT -> 113,000', () => {
  assert.deepEqual(computeOrderTotals({ subtotal: 100000, vatPercentage: 14, withholdingTaxPercentage: 1 }), { subtotal: 100000, vatAmount: 14000, withholdingTaxAmount: 1000, total: 113000 });
});

test('no taxes configured -> tax is exactly 0 and Total Amount equals the subtotal (a tax is never invented)', () => {
  for (const noTax of [{}, { vatPercentage: 0 }, { vatPercentage: null, withholdingTaxPercentage: undefined }, { vatPercentage: '', withholdingTaxPercentage: '0' }]) {
    const totals = computeOrderTotals({ subtotal: 2500, ...noTax });
    assert.equal(totals.vatAmount, 0);
    assert.equal(totals.withholdingTaxAmount, 0);
    assert.equal(totals.total, 2500);
  }
});

test('a negative/invalid percentage never produces a negative tax', () => {
  assert.equal(computeOrderTotals({ subtotal: 1000, vatPercentage: -5 }).vatAmount, 0);
  assert.equal(computeOrderTotals({ subtotal: 1000, vatPercentage: 'abc' }).vatAmount, 0);
});

test('amounts are rounded to 2 decimals', () => {
  const totals = computeOrderTotals({ subtotal: 333.33, vatPercentage: 14 });
  assert.equal(totals.vatAmount, 46.67);
  assert.equal(totals.total, 380);
});

test('getOrderTotalAmount prefers grandTotal, falls back to totalAmount for legacy orders, never crashes on null', () => {
  assert.equal(getOrderTotalAmount({ totalAmount: 100000, grandTotal: 114000 }), 114000);
  assert.equal(getOrderTotalAmount({ totalAmount: 5000 }), 5000, 'an order saved before grandTotal existed reports its subtotal');
  assert.equal(getOrderTotalAmount({ totalAmount: 5000, grandTotal: 0 }), 0, 'a real 0 grandTotal is respected');
  assert.equal(getOrderTotalAmount(null), 0);
  assert.equal(getOrderTotalAmount({}), 0);
});

test('aggregation expression mirrors getOrderTotalAmount (grandTotal, then totalAmount, then 0)', () => {
  assert.deepEqual(ORDER_TOTAL_AMOUNT_EXPR, { $ifNull: ['$grandTotal', { $ifNull: ['$totalAmount', 0] }] });
  assert.deepEqual(orderTotalAmountExpr('$$o.'), { $ifNull: ['$$o.grandTotal', { $ifNull: ['$$o.totalAmount', 0] }] });
});
