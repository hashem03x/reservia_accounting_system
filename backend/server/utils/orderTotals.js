// Single source of truth for a Sales/Purchase Order's money figures. Both order models compute
// their persisted totals through computeOrderTotals() in their own pre('save') hooks, and every
// report/dashboard/aggregation that needs "the order amount" reads it through getOrderTotalAmount()
// (JS) or ORDER_TOTAL_AMOUNT_EXPR (aggregation) - never its own formula.
//
// Field meanings (persisted on both SalesOrder and PurchaseOrder):
//   totalAmount          = Σ item subtotals (after discounts/returns) - the pre-tax SUBTOTAL. The
//                          name predates VAT support and is kept for compatibility with existing
//                          documents/queries; it is NOT the order amount.
//   vatAmount            = totalAmount × vatPercentage / 100
//   withholdingTaxAmount = totalAmount × withholdingTaxPercentage / 100
//   grandTotal           = totalAmount + vatAmount - withholdingTaxAmount - the ORDER TOTAL AMOUNT.
//                          This is the canonical "order amount" used for display, reports, KPIs,
//                          remainingAmount/paymentStatus and the supplier/customer payable.
//
// A missing/zero percentage always yields exactly 0 tax - a tax is never invented.

const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;

function toPercentage(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * @param {{ subtotal: number, vatPercentage?: number, withholdingTaxPercentage?: number }} params
 * @returns {{ subtotal: number, vatAmount: number, withholdingTaxAmount: number, total: number }}
 */
function computeOrderTotals({ subtotal, vatPercentage, withholdingTaxPercentage }) {
  const base = Number(subtotal) || 0;
  const vatAmount = round2((base * toPercentage(vatPercentage)) / 100);
  const withholdingTaxAmount = round2((base * toPercentage(withholdingTaxPercentage)) / 100);
  return { subtotal: base, vatAmount, withholdingTaxAmount, total: round2(base + vatAmount - withholdingTaxAmount) };
}

/**
 * The order's final Total Amount for any already-persisted order (document or lean object).
 * Orders saved before `grandTotal` existed have no such field stored - for those the subtotal IS
 * the total (no VAT/withholding could have been applied before those fields existed).
 */
function getOrderTotalAmount(order) {
  if (!order) return 0;
  if (typeof order.grandTotal === 'number') return order.grandTotal;
  return order.totalAmount || 0;
}

// Aggregation-pipeline equivalent of getOrderTotalAmount(). `prefix` lets it address an order
// embedded under a path (e.g. '$salesOrders.' inside a $lookup result).
function orderTotalAmountExpr(prefix = '$') {
  return { $ifNull: [`${prefix}grandTotal`, { $ifNull: [`${prefix}totalAmount`, 0] }] };
}

const ORDER_TOTAL_AMOUNT_EXPR = orderTotalAmountExpr();

module.exports = { computeOrderTotals, getOrderTotalAmount, orderTotalAmountExpr, ORDER_TOTAL_AMOUNT_EXPR, round2 };
