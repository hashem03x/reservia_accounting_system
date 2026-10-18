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
    return subcategories.filter((subcategory) => subcategory.mainCategory?._id === mainCategoryId);
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

  return {
    getMainCategoryById,
    getSubcategoriesByMainCategoryId,
    getMainCategoryNameOfSubcategory,
    getSubcategoryNameOfProduct,
    getMainCategoryNameById,
    getSubcategoryNameById,
    getBrandNameById,
  };
}
