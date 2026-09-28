import { UploadedImage } from "@/types/global";

export type Product = {
  _id: string;
  title: { en: string; ar: string };
  description: { en: string; ar: string };
  cost: number;
  price: number;
  priceAfterDiscount: number | null;
  isDeleted: boolean;
  isAvailable: boolean;
  totalSold: number;
  season: Season;
  category: string;
  subcategory: string;
  colors: ProductColor[];
  variants: Variant[];
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
