import { useLanguage } from "@/context/LanguageContext";
import { useMainCategories } from "@/context/MainCategoriesContext";
import useCategoryHelpers from "@/hooks/useCategoryHelpers";
import { Select, TextInput } from "@mantine/core";
import { useProduct } from "../../context";

// Catalog hierarchy of a physical product: Main Category -> Brand -> Model/Item -> Technical
// Specifications. Brand is one of the selected Main Category's subcategories (saved in the product's
// `subcategory` field) - the list shows only that category's subcategories and is cleared when the
// category changes. Shown for products only - service classification is pending client confirmation
// and is unchanged.
export default function CategoriesInformation() {
  const { translate } = useLanguage();

  const { category, setCategory, brand, setBrand, model, setModel, specifications, setSpecifications, readOnly } = useProduct();

  const { data: mainCategories } = useMainCategories();
  const { getSubcategoriesByMainCategoryId } = useCategoryHelpers();

  const brandOptions = getSubcategoriesByMainCategoryId(category || "").map((s) => ({ label: translate(s.name.en, s.name.ar), value: s._id }));

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
          // A brand belongs to its main category - a new category starts without one.
          if (value !== category) setBrand(null);
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
        label={translate("Brand", "الماركة")}
        placeholder={category ? translate("Brand", "الماركة") : translate("Select the main category first", "اختر الفئة الرئيسية أولاً")}
        value={brand}
        onChange={(value) => setBrand(value)}
        data={brandOptions}
        disabled={!category}
        nothingFoundMessage={translate("No brands under this category", "لا توجد ماركات لهذه الفئة")}
        readOnly={readOnly}
      />
      <TextInput
        label={translate("Model / Item", "الموديل / الصنف")}
        placeholder={translate("Model / Item", "الموديل / الصنف")}
        value={model}
        onChange={(e) => setModel(e.currentTarget.value)}
        readOnly={readOnly}
      />
      <TextInput
        label={translate("Technical Specifications", "المواصفات الفنية")}
        placeholder={translate("Technical Specifications", "المواصفات الفنية")}
        value={specifications}
        onChange={(e) => setSpecifications(e.currentTarget.value)}
        readOnly={readOnly}
      />
    </div>
  );
}
