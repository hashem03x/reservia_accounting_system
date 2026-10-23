// Price (and cost) are optional to define a product - both helpers return null / "-" when unknown.
export function getProductFinalPrice(priceAfterDiscount: number | null, price: number | undefined | null): number | null {
  return priceAfterDiscount || (typeof price === "number" ? price : null);
}

/** A price for display: 2 decimals, or "-" when the product has none. */
export function priceText(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : "-";
}
