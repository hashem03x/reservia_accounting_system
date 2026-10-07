import { useLanguage } from "@/context/LanguageContext";
import { useMainCategories } from "@/context/MainCategoriesContext";
import useCategoryHelpers from "@/hooks/useCategoryHelpers";
import { Select } from "@mantine/core";
import { useProduct } from "../../context";

export default function CategoriesInformation() {
  const { translate } = useLanguage();

  const { category, setCategory, subcategory, setSubcategory, readOnly } = useProduct();

  const { data: mainCategories } = useMainCategories();
  const { getSubcategoriesByMainCategoryId } = useCategoryHelpers();

  // Subcategories options depend on the selected main category
  const subcategories = category ? getSubcategoriesByMainCategoryId(category) : [];

  return (
    <div className="product-details-box h-full">
      <h3>{translate("Categories Information", "معلومات الفئات")}</h3>
      <Select
        withAsterisk
        searchable
        allowDeselect={false}
        label={translate("Main Category", "الفئة الرئيسية")}
        placeholder={translate("Main Category", "الفئة الرئيسية")}
        value={category}
        onChange={(value) => {
          setCategory(value);
          setSubcategory(null);
        }}
        data={mainCategories.map((mainCategory) => ({
          label: translate(mainCategory.name.en, mainCategory.name.ar),
          value: mainCategory._id,
        }))}
        readOnly={readOnly}
      />
      <Select
        withAsterisk
        searchable
        label={translate("Subcategory", "الفئة الفرعية")}
        placeholder={translate("Subcategory", "الفئة الفرعية")}
        value={subcategory}
        onChange={(value) => setSubcategory(value)}
        data={subcategories.map((subCategory) => ({
          label: translate(subCategory.name.en, subCategory.name.ar),
          value: subCategory._id,
        }))}
        readOnly={readOnly}
      />
    </div>
  );
}
