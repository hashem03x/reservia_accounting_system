import { createContext, ReactNode, useContext, useState } from "react";
import { Product, ProductType } from "@/types/product";
import { DurationUnit } from "@/utils/constants/product-types";
import resources from "@/utils/constants/resources";
import actions from "@/utils/constants/actions";
import useHasPermission from "@/hooks/useHasPermission";

export type ProductCapacityInput = {
  value: string | number;
  unit: string;
};

export type ProductStockInput = {
  warehouse: string;
  quantity: string | number;
};

type ProductContextProps = {
  // For the Input Fields
  type: ProductType;
  setType: React.Dispatch<React.SetStateAction<ProductType>>;
  durationValue: string | number;
  setDurationValue: React.Dispatch<React.SetStateAction<string | number>>;
  durationUnit: DurationUnit;
  setDurationUnit: React.Dispatch<React.SetStateAction<DurationUnit>>;
<<<<<<< HEAD
  // Service-only: id of the PUC Chart of Accounts account a purchase of this service posts to.
  pucAccount: string | null;
  setPucAccount: React.Dispatch<React.SetStateAction<string | null>>;
=======
>>>>>>> 368811657e0eba1f2e8b46ee732d01745194d628
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
  category: string | null;
  setCategory: React.Dispatch<React.SetStateAction<string | null>>;
  subcategory: string | null;
  setSubcategory: React.Dispatch<React.SetStateAction<string | null>>;
  capacity: ProductCapacityInput;
  setCapacity: React.Dispatch<React.SetStateAction<ProductCapacityInput>>;
  // A Product is the sellable/stock-tracked item itself now - there is no separate Variant (see
  // docs/entities/products.md).
  sku: string;
  setSku: React.Dispatch<React.SetStateAction<string>>;
  barcode: string;
  setBarcode: React.Dispatch<React.SetStateAction<string>>;
  stock: ProductStockInput[];
  setStock: React.Dispatch<React.SetStateAction<ProductStockInput[]>>;
  // For Reading & Updating
  currentProduct: Product | null;
  setCurrentProduct: React.Dispatch<React.SetStateAction<Product | null>>;
  // For Permissions
  canIUpdateProducts: boolean;
  canIDeleteProducts: boolean;
  readOnly: boolean;
};

export const ProductContext = createContext<ProductContextProps>({
  type: "product",
  setType: () => {},
  durationValue: "",
  setDurationValue: () => {},
  durationUnit: "month",
  setDurationUnit: () => {},
<<<<<<< HEAD
  pucAccount: null,
  setPucAccount: () => {},
=======
>>>>>>> 368811657e0eba1f2e8b46ee732d01745194d628
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
  category: null,
  setCategory: () => {},
  subcategory: null,
  setSubcategory: () => {},
  capacity: { value: "", unit: "" },
  setCapacity: () => {},
  sku: "",
  setSku: () => {},
  barcode: "",
  setBarcode: () => {},
  stock: [],
  setStock: () => {},
  currentProduct: null,
  setCurrentProduct: () => {},
  canIUpdateProducts: false,
  canIDeleteProducts: false,
  readOnly: false,
});

export default function ProductFormProvider({ product, children }: { product?: Product; children: ReactNode }) {
  const [type, setType] = useState<ProductType>(product?.type || "product");
  const [durationValue, setDurationValue] = useState<string | number>(product?.durationValue || "");
  const [durationUnit, setDurationUnit] = useState<DurationUnit>(product?.durationUnit || "month");
<<<<<<< HEAD
  const [pucAccount, setPucAccount] = useState<string | null>(getPucAccountId(product));
=======
>>>>>>> 368811657e0eba1f2e8b46ee732d01745194d628
  const [titleEn, setTitleEn] = useState(product?.title.en || "");
  const [titleAr, setTitleAr] = useState(product?.title.ar || "");
  const [descriptionEn, setDescriptionEn] = useState(product?.description.en || "");
  const [descriptionAr, setDescriptionAr] = useState(product?.description.ar || "");
  const [cost, setCost] = useState<string | number>(product?.cost || "");
  const [price, setPrice] = useState<string | number>(product?.price || "");
  const [priceAfterDiscount, setPriceAfterDiscount] = useState<string | number>(product?.priceAfterDiscount || "");
  const [isAvailable, setIsAvailable] = useState<boolean>(product ? product.isAvailable : true);
  const [category, setCategory] = useState<string | null>(product?.category || null);
  const [subcategory, setSubcategory] = useState<string | null>(product?.subcategory || null);
  const [capacity, setCapacity] = useState<ProductCapacityInput>({
    value: product?.capacity?.value ?? "",
    unit: product?.capacity?.unit || "",
  });
  const [sku, setSku] = useState<string>(product?.sku || "");
  const [barcode, setBarcode] = useState<string>(product?.barcode || "");
  const [stock, setStock] = useState<ProductStockInput[]>(product?.stock ? JSON.parse(JSON.stringify(product.stock)) : []);

  const [currentProduct, setCurrentProduct] = useState<Product | null>(product || null);

  const canIUpdateProducts = useHasPermission(resources.products, actions.update);
  const canIDeleteProducts = useHasPermission(resources.products, actions.delete);
  const readOnly = !!currentProduct && !canIUpdateProducts;

  return (
    <ProductContext.Provider
      value={{
        type,
        setType,
        durationValue,
        setDurationValue,
        durationUnit,
        setDurationUnit,
<<<<<<< HEAD
        pucAccount,
        setPucAccount,
=======
>>>>>>> 368811657e0eba1f2e8b46ee732d01745194d628
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
        category,
        setCategory,
        subcategory,
        setSubcategory,
        capacity,
        setCapacity,
        sku,
        setSku,
        barcode,
        setBarcode,
        stock,
        setStock,
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
<<<<<<< HEAD

// The API returns pucAccount populated ({ _id, code, name }); older services have none.
export function getPucAccountId(product?: Product | null): string | null {
  const value = product?.pucAccount;
  if (!value) return null;
  return typeof value === "string" ? value : value._id || null;
}
=======
>>>>>>> 368811657e0eba1f2e8b46ee732d01745194d628
