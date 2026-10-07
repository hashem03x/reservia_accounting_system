import { Product } from "@/types/product";

/**
 * The default unit price of an item on a Purchase Order line, per item type:
 * - Product: its `cost` (purchase cost, required for every product - unchanged behaviour).
 * - Service: its `price`. A service has no `cost` field at all (cost is a stock/inventory concept),
 *   and `price` is the only price a service carries (required by the backend model).
 * The user can still edit the unit price on the line.
 */
export function getPurchaseUnitPrice(product: Pick<Product, "type" | "cost" | "price">): number {
  return product.type === "service" ? product.price : (product.cost as number);
}
