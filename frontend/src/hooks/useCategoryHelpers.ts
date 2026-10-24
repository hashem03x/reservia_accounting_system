import { Subcategory } from "@/types/categories";
import { useLanguage } from "@/context/LanguageContext";
import { useMainCategories } from "@/context/MainCategoriesContext";
import { useSubcategories } from "@/context/SubcategoriesContext";
import { useBrands } from "@/context/BrandsContext";

export default function useCategoryHelpers() {
  const { data: mainCategories } = useMainCategories();
  const { data: subcategories } = useSubcategories();
  const { data: brands } = useBrands();
  const { translate } = useLanguage();

  function getMainCategoryById(mainCategoryId: string) {
    return mainCategories?.find((category) => category._id === mainCategoryId);
  }

  function getSubcategoriesByMainCategoryId(mainCategoryId: string): Subcategory[] {
    if (!subcategories || !mainCategoryId) return [];
    // mainCategory may arrive populated or as a bare id.
    return subcategories.filter((subcategory) => (subcategory.mainCategory?._id || (subcategory.mainCategory as unknown as string)) === mainCategoryId);
  }

  function getMainCategoryNameOfSubcategory(subcategory: Subcategory): string {
    if (!mainCategories || !subcategory?.mainCategory?._id) return "";
    const mainCategory = mainCategories.find((category) => category._id === subcategory.mainCategory._id);
    if (!mainCategory) return "";
    return translate(mainCategory.name.en, mainCategory.name.ar);
  }

  function getSubcategoryNameOfProduct(product: { subcategory: string }): string {
    if (!subcategories || !product?.subcategory) return "";
    const productSubcategory = subcategories.find((sub) => sub._id === product.subcategory);
    if (!productSubcategory) return "";
    return translate(productSubcategory.name.en, productSubcategory.name.ar);
  }

  function getMainCategoryNameById(mainCategoryId: string): string {
    if (!mainCategories || !mainCategoryId) return "";
    const mainCategory = mainCategories.find((category) => category._id === mainCategoryId);
    if (!mainCategory) return "";
    return translate(mainCategory.name.en, mainCategory.name.ar);
  }

  function getSubcategoryNameById(subcategoryId: string): string {
    const subcategory = subcategories.find((sub) => sub._id === subcategoryId);
    if (!subcategory) return "";
    return translate(subcategory.name.en, subcategory.name.ar);
  }

  // Brand replaces Subcategory as a product's primary identification field under Category - flat
  // (no mainCategory scoping), unlike getSubcategoriesByMainCategoryId above.
  function getBrandNameById(brandId: string): string {
    const brand = brands?.find((b) => b._id === brandId);
    if (!brand) return "";
    return translate(brand.name.en, brand.name.ar);
  }

  // A product's Brand is its Subcategory (a subcategory of its Main Category). Products saved before
  // that only have the old flat `brand` - shown as a fallback.
  function getProductBrandName(product?: { subcategory?: string | null; brand?: string | null } | null): string {
    if (!product) return "";
    return (product.subcategory && getSubcategoryNameById(product.subcategory)) || (product.brand ? getBrandNameById(product.brand) : "");
  }

  return {
    getMainCategoryById,
    getSubcategoriesByMainCategoryId,
    getMainCategoryNameOfSubcategory,
    getSubcategoryNameOfProduct,
    getMainCategoryNameById,
    getSubcategoryNameById,
    getBrandNameById,
    getProductBrandName,
  };
}
