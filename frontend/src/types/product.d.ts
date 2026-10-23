export type ProductType = "product" | "service";

export type Product = {
  _id: string;
  /** Defaults to "product" server-side. See docs/entities/products.md for the full behavior split. */
  type: ProductType;
  title: { en: string; ar: string };
  description: { en: string; ar: string };
  // Product-only fields - absent/meaningless when type === "service". Cost (like price) is optional:
  // a product can be defined before it is bought or priced.
  cost?: number;
  category?: string;
  // Catalog hierarchy: Main Category -> Subcategory -> Brand -> Model/Item -> Specifications.
  // Services use Main Category + Subcategory only. Subcategory is optional (older products have none).
  subcategory?: string;
  brand?: string;
  model?: string;
  specifications?: string;
  // A Product is the sellable/stock-tracked item itself now - there is no separate Variant (see
  // docs/entities/products.md). `stock`/`sku`/`barcode` are absent/meaningless for a service.
  sku?: string;
  barcode?: string;
  stock?: ProductStock[];
  // Integrated Energy spec (e.g. "100 kW") - optional, absent on products created before this
  // field existed.
  capacity?: ProductCapacity;
  // Service-only fields - absent/meaningless when type === "product".
  durationValue?: number;
  durationUnit?: "month";
  // Service-only: the PUC (Projects Under Construction) Chart of Accounts account a purchase of this
  // service posts to. Populated object from the API; null/absent for a service created before this
  // field existed (it must be set before the service can be purchased).
  pucAccount?: { _id: string; code: string; name: string; nameAr?: string | null } | string | null;
  price?: number; // Also doubles as the service's selling price when type === "service". Optional - see cost.
  priceAfterDiscount: number | null;
  isDeleted: boolean;
  isAvailable: boolean;
  totalSold: number;
  ratingsQuantity?: number;
  ratingsAverage?: number;
  createdAt: Date;
  updatedAt: Date;
};

// ============================================================================

export type ProductCapacity = {
  value?: number;
  unit?: string;
};

// ============================================================================

export type ProductStock = {
  warehouse: string;
  quantity: number;
  starterQuantity?: number;
};
