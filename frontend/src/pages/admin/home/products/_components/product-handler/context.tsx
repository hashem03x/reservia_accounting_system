import { createContext, ReactNode, useContext, useState } from "react";
import { Color, Product, Season, Variant } from "@/types/product";
import { UploadedImage } from "@/types/global";
import resources from "@/utils/constants/resources";
import actions from "@/utils/constants/actions";
import useHasPermission from "@/hooks/useHasPermission";

export type ProductColorInput = {
  name: Color;
  code: string;
  images: (UploadedImage | File)[];
  deleteImages?: string[];
};

type ProductContextProps = {
  // For the Input Fields
  titleEn: string;
  setTitleEn: React.Dispatch<React.SetStateAction<string>>;
  titleAr: string;
  setTitleAr: React.Dispatch<React.SetStateAction<string>>;
  descriptionEn: string;
  setDescriptionEn: React.Dispatch<React.SetStateAction<string>>;
  descriptionAr: string;
  setDescriptionAr: React.Dispatch<React.SetStateAction<string>>;
  cost: string | number;
  setCost: React.Dispatch<React.SetStateAction<string | number>>;
  price: string | number;
  setPrice: React.Dispatch<React.SetStateAction<string | number>>;
  priceAfterDiscount: string | number;
  setPriceAfterDiscount: React.Dispatch<React.SetStateAction<string | number>>;
  isAvailable: boolean;
  setIsAvailable: React.Dispatch<React.SetStateAction<boolean>>;
  season: Season;
  setSeason: React.Dispatch<React.SetStateAction<Season>>;
  category: string | null;
  setCategory: React.Dispatch<React.SetStateAction<string | null>>;
  subcategory: string | null;
  setSubcategory: React.Dispatch<React.SetStateAction<string | null>>;
  colors: ProductColorInput[];
  setColors: React.Dispatch<React.SetStateAction<ProductColorInput[]>>;
  tags: string[];
  setTags: React.Dispatch<React.SetStateAction<string[]>>;
  variants: Variant[];
  setVariants: React.Dispatch<React.SetStateAction<Variant[]>>;
  // For Reading & Updating
  currentProduct: Product | null;
  setCurrentProduct: React.Dispatch<React.SetStateAction<Product | null>>;
  // For Permissions
  canIUpdateProducts: boolean;
  canIDeleteProducts: boolean;
  readOnly: boolean;
};

export const ProductContext = createContext<ProductContextProps>({
  titleEn: "",
  setTitleEn: () => {},
  titleAr: "",
  setTitleAr: () => {},
  descriptionEn: "",
  setDescriptionEn: () => {},
  descriptionAr: "",
  setDescriptionAr: () => {},
  cost: "",
  setCost: () => {},
  price: "",
  setPrice: () => {},
  priceAfterDiscount: "",
  setPriceAfterDiscount: () => {},
  isAvailable: true,
  setIsAvailable: () => {},
  season: "all",
  setSeason: () => {},
  category: null,
  setCategory: () => {},
  subcategory: null,
  setSubcategory: () => {},
  colors: [],
  setColors: () => {},
  tags: [],
  setTags: () => {},
  variants: [],
  setVariants: () => {},
  currentProduct: null,
  setCurrentProduct: () => {},
  canIUpdateProducts: false,
  canIDeleteProducts: false,
  readOnly: false,
});

export default function ProductFormProvider({ product, children }: { product?: Product; children: ReactNode }) {
  const [titleEn, setTitleEn] = useState(product?.title.en || "");
  const [titleAr, setTitleAr] = useState(product?.title.ar || "");
  const [descriptionEn, setDescriptionEn] = useState(product?.description.en || "");
  const [descriptionAr, setDescriptionAr] = useState(product?.description.ar || "");
  const [cost, setCost] = useState<string | number>(product?.cost || "");
  const [price, setPrice] = useState<string | number>(product?.price || "");
  const [priceAfterDiscount, setPriceAfterDiscount] = useState<string | number>(product?.priceAfterDiscount || "");
  const [isAvailable, setIsAvailable] = useState<boolean>(product ? product.isAvailable : true);
  const [season, setSeason] = useState<Season>(product?.season || "all");
  const [category, setCategory] = useState<string | null>(product?.category || null);
  const [subcategory, setSubcategory] = useState<string | null>(product?.subcategory || null);
  const [colors, setColors] = useState<ProductColorInput[]>(product ? JSON.parse(JSON.stringify(product.colors)) : []);
  const [tags, setTags] = useState<string[]>(product?.tags ? [...product.tags] : []);
  const [variants, setVariants] = useState<Variant[]>(product ? JSON.parse(JSON.stringify(product.variants)) : []);

  const [currentProduct, setCurrentProduct] = useState<Product | null>(product || null);

  const canIUpdateProducts = useHasPermission(resources.products, actions.update);
  const canIDeleteProducts = useHasPermission(resources.products, actions.delete);
  const readOnly = !!currentProduct && !canIUpdateProducts;

  return (
    <ProductContext.Provider
      value={{
        titleEn,
        setTitleEn,
        titleAr,
        setTitleAr,
        descriptionEn,
        setDescriptionEn,
        descriptionAr,
        setDescriptionAr,
        cost,
        setCost,
        price,
        setPrice,
        priceAfterDiscount,
        setPriceAfterDiscount,
        isAvailable,
        setIsAvailable,
        season,
        setSeason,
        category,
        setCategory,
        subcategory,
        setSubcategory,
        colors,
        setColors,
        tags,
        setTags,
        variants,
        setVariants,
        currentProduct,
        setCurrentProduct,
        canIUpdateProducts,
        canIDeleteProducts,
        readOnly,
      }}
    >
      {children}
    </ProductContext.Provider>
  );
}

export const useProduct = () => useContext(ProductContext);
