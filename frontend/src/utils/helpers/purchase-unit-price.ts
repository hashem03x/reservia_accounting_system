import { Product } from "@/types/product";

/**
 * The default unit price of an item on a Purchase Order line, per item type:
 * - Product: its `cost` (purchase cost).
 * - Service: its `price`. A service has no `cost` field at all (cost is a stock/inventory concept).
 * Both are optional to define a product (backend productModel.js#cost), so this is null when the
 * catalog has none - the line then starts empty for the user to enter, never a silent 0.
 * The user can still edit the unit price on the line.
 */
export function getPurchaseUnitPrice(product: Pick<Product, "type" | "cost" | "price">): number | null {
  const value = product.type === "service" ? product.price : product.cost;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
