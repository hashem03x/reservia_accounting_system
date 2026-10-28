/** What is left to invoice on the selected Purchase Order, per product
 * (GET requisitions/:id/remaining-quantities - enforced again by the backend on save). */
export type PurchaseOrderLine = { product: string; ordered: number; invoiced: number; remaining: number; unitPrice: number };
/** `hasUnmatchableLines`: the Purchase Order has legacy description-only lines, so a product that
 * is not on it can't be refused here (the backend's amount guard still applies). */
export type PurchaseOrderLines = { lines: PurchaseOrderLine[]; hasUnmatchableLines: boolean };

export type OrderItemInput = {
  productCode: string;
  productError: boolean;
  /** The actual backend error message (e.g. a stock/validation error), when available - falls back
   * to a generic "not found" message when the lookup failed for a reason with no message (e.g. the
   * request was aborted). */
  productErrorMessage?: string;
  // The following always come together (product data and its inputs)
  // 1. The original product data coming from the server
  productData: {
    _id: string;
    title: { en: string; ar: string };
    cost: number;
    price: number;
  } | null;
  // 2. For the inputs
  unitPrice: number;
  itemDiscount: ItemDiscount;
  unitPriceAfterDiscount: number;
  starterQuantity: number;
  starterSubtotal: number;
};
