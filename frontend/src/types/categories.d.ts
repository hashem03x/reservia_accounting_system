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
