import { Language } from "@/types/language";
import { LocalizedEntity } from "@/types/global";
import { ProductType } from "@/types/product";
import translate from "@/utils/helpers/translate";

const productTypes: LocalizedEntity<ProductType> = {
  product: {
    value: "product",
    label: {
      en: "Product",
      ar: "منتج",
    },
  },
  service: {
    value: "service",
    label: {
      en: "Service",
      ar: "خدمة",
    },
  },
};

export default productTypes;

export const productTypesArray = Object.values(productTypes);

// ================ Helpers ================

export const getProductTypeLabel = (productType: ProductType, language: Language) => {
  return translate(language, productTypes[productType].label.en, productTypes[productType].label.ar);
};

export function isService(productType: ProductType) {
  return productType === productTypes.service.value;
}

// ================ Duration Units ================

export type DurationUnit = "month";

const durationUnits: LocalizedEntity<DurationUnit> = {
  month: {
    value: "month",
    label: {
      en: "Month(s)",
      ar: "شهر/أشهر",
    },
  },
};

export const durationUnitsArray = Object.values(durationUnits);

export const getDurationUnitLabel = (durationUnit: DurationUnit, language: Language) => {
  return translate(language, durationUnits[durationUnit].label.en, durationUnits[durationUnit].label.ar);
};
