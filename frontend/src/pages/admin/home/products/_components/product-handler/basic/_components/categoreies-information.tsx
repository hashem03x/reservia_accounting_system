import { useLanguage } from "@/context/LanguageContext";
import { useMainCategories } from "@/context/MainCategoriesContext";
import { useBrands } from "@/context/BrandsContext";
import { Select, TextInput } from "@mantine/core";
import { useProduct } from "../../context";

// Catalog hierarchy of a physical product: Main Category -> Brand -> Model/Item -> Technical
// Specifications. Brand is the second level - it replaces the legacy Subcategory (which is no
// longer selected here; a product's stored subcategory is kept untouched). Shown for products only -
// service classification is pending client confirmation and is unchanged.
export default function CategoriesInformation() {
  const { translate } = useLanguage();

  const { category, setCategory, brand, setBrand, model, setModel, specifications, setSpecifications, readOnly } = useProduct();

  const { data: mainCategories } = useMainCategories();
  const { data: brands } = useBrands();

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
        onChange={(value) => setCategory(value)}
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
        placeholder={translate("Brand", "الماركة")}
        value={brand}
        onChange={(value) => setBrand(value)}
        data={brands.map((b) => ({
          label: translate(b.name.en, b.name.ar),
          value: b._id,
        }))}
        nothingFoundMessage={translate("No brands found", "لا توجد ماركات")}
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
