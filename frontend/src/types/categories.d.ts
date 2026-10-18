import { ContextProps } from "@/types/global";

export type MainCategory = {
  _id: string;
  name: {
    en: string;
    ar: string;
  };
  createdAt: string;
  updatedAt: string;
};

export type MainCategoriesContextProps = ContextProps<MainCategory[]>;

// =================================================================

export type Subcategory = {
  _id: string;
  name: {
    en: string;
    ar: string;
  };
  tags: string[];
  image: string;
  mainCategory: MainCategory;
  createdAt: string;
  updatedAt: string;
};

export type SubcategoriesContextProps = ContextProps<Subcategory[]>;

// =================================================================

// Primary product identification field under Category (Category -> Brand -> Model/Item Number) -
// replaces Subcategory as the field a product form surfaces. Flat (no mainCategory link) - a
// brand is not scoped to one category, unlike the legacy Subcategory.
export type Brand = {
  _id: string;
  name: {
    en: string;
    ar: string;
  };
  image?: string;
  createdAt: string;
  updatedAt: string;
};

export type BrandsContextProps = ContextProps<Brand[]>;
