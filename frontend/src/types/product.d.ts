import { UploadedImage } from "@/types/global";

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
  colors: ProductColor[];
  variants: Variant[];
  // Service-only fields - absent/meaningless when type === "product".
  durationValue?: number;
  durationUnit?: "month";
  price: number; // Also doubles as the service's selling price when type === "service".
  priceAfterDiscount: number | null;
  isDeleted: boolean;
  isAvailable: boolean;
  totalSold: number;
  season: Season;
  /** Normalized (trimmed, deduped, non-empty) by the backend - see productValidator.js. */
  tags: string[];
  ratingsQuantity?: number;
  ratingsAverage?: number;
  createdAt: Date;
  updatedAt: Date;
};

// ============================================================================

export type Season = "summer" | "winter" | "all";

export type Color =
  | "black"
  | "white"
  | "red"
  | "green"
  | "blue"
  | "yellow"
  | "orange"
  | "brown"
  | "cream"
  | "olive"
  | "navy"
  | "pink"
  | "gray"
  | "purple"
  | "coffee"
  | "beige"
  | "khaki"
  | "gold"
  | "silver"
  | "maroon"
  | "teal";

export type ProductColor = {
  name: Color;
  code: string;
  images: UploadedImage[];
};

// ============================================================================

export type Variant = {
  _id: string;
  color: Color;
  size: string;
  variantCode: string;
  stock: { warehouse: string; quantity: number }[];
  isDeleted: boolean;
};
