import { useLanguage } from "@/context/LanguageContext";
import { useMainCategories } from "@/context/MainCategoriesContext";
import { useSubcategories } from "@/context/SubcategoriesContext";
import { useBrands } from "@/context/BrandsContext";
import { Select, TextInput } from "@mantine/core";
import { useProduct } from "../../context";

// Catalog hierarchy of a physical product: Main Category -> Subcategory -> Brand -> Model/Item ->
// Technical Specifications (client requirement "Products - Category, Brand, Model/Item,
// Specifications"). The Subcategory list shows only the selected Main Category's subcategories and
// is cleared when the category changes. Shown for products only - service classification is pending
// client confirmation and is unchanged.
export default function CategoriesInformation() {
  const { translate } = useLanguage();

  const { category, setCategory, subcategory, setSubcategory, brand, setBrand, model, setModel, specifications, setSpecifications, readOnly } = useProduct();

  const { data: mainCategories } = useMainCategories();
  const { data: subcategories } = useSubcategories();
  const { data: brands } = useBrands();

  const subcategoryOptions = subcategories
    .filter((s) => category && (s.mainCategory?._id || (s.mainCategory as unknown as string)) === category)
    .map((s) => ({ label: translate(s.name.en, s.name.ar), value: s._id }));

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
          // A subcategory always belongs to its main category - a new category starts without one.
          if (value !== category) setSubcategory(null);
        }}
        data={mainCategories.map((mainCategory) => ({
          label: translate(mainCategory.name.en, mainCategory.name.ar),
          value: mainCategory._id,
        }))}
        readOnly={readOnly}
      />
      <Select
        searchable
        clearable
        label={translate("Subcategory (optional)", "الفئة الفرعية (اختياري)")}
        placeholder={category ? translate("Subcategory", "الفئة الفرعية") : translate("Select the main category first", "اختر الفئة الرئيسية أولاً")}
        value={subcategory}
        onChange={(value) => setSubcategory(value)}
        data={subcategoryOptions}
        disabled={!category}
        nothingFoundMessage={translate("No subcategories under this category", "لا توجد فئات فرعية لهذه الفئة")}
        readOnly={readOnly}
      />
      <Select
        withAsterisk
        searchable
        label={translate("Brand", "الماركة")}
        placeholder={translate("Brand", "الماركة")}
        value={brand}
        onChange={(value) => setBrand(value)}
        data={brands.map((b) => ({
          label: translate(b.name.en, b.name.ar),
          value: b._id,
        }))}
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
