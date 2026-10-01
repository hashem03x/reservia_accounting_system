export type ProductType = "product" | "service";

export type Product = {
  _id: string;
  /** Defaults to "product" server-side. See docs/entities/products.md for the full behavior split. */
  type: ProductType;
  title: { en: string; ar: string };
  description: { en: string; ar: string };
  // Product-only fields - absent/meaningless when type === "service".
  cost?: number;
  category?: string;
  subcategory?: string;
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
  price: number; // Also doubles as the service's selling price when type === "service".
  priceAfterDiscount: number | null;
  isDeleted: boolean;
  isAvailable: boolean;
  totalSold: number;
  season: Season;
  ratingsQuantity?: number;
  ratingsAverage?: number;
  createdAt: Date;
  updatedAt: Date;
};

// ============================================================================

export type Season = "summer" | "winter" | "all";

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
