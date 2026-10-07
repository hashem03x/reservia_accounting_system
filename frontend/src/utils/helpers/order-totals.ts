// Frontend mirror of backend/server/utils/orderTotals.js - the ONE place the UI derives an order's
// money figures. The backend recomputes and persists every amount on save and is the source of
// truth; the preview here only exists so a New Sales/Purchase Order form can show the user the
// same Total Amount the server will store.
//
//   totalAmount (persisted)  = pre-tax SUBTOTAL (Σ item subtotals) - legacy field name
//   grandTotal  (persisted)  = subtotal + VAT - withholding = the ORDER TOTAL AMOUNT

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const toPercentage = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export type OrderTotals = { subtotal: number; vatAmount: number; withholdingTaxAmount: number; total: number };

export function calculateOrderTotals(
  subtotal: number,
  vatPercentage?: number | string | null,
  withholdingTaxPercentage?: number | string | null,
): OrderTotals {
  const base = Number(subtotal) || 0;
  const vatAmount = round2((base * toPercentage(vatPercentage)) / 100);
  const withholdingTaxAmount = round2((base * toPercentage(withholdingTaxPercentage)) / 100);
  return { subtotal: base, vatAmount, withholdingTaxAmount, total: round2(base + vatAmount - withholdingTaxAmount) };
}

type OrderAmountFields = { totalAmount?: number | null; grandTotal?: number | null } | null | undefined;

/** The order's final Total Amount (incl. VAT, net of withholding). Legacy orders saved before
 * `grandTotal` existed fall back to their subtotal (no tax could apply to them). Never throws. */
export function getOrderTotal(order: OrderAmountFields): number {
  if (!order) return 0;
  if (typeof order.grandTotal === "number") return order.grandTotal;
  return order.totalAmount || 0;
}

/** The order's pre-tax subtotal (persisted as `totalAmount`). */
export function getOrderSubtotal(order: OrderAmountFields): number {
  return order?.totalAmount || 0;
}
