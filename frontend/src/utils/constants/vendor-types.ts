import { Language } from "@/types/language";
import { LocalizedEntity } from "@/types/global";
import { VendorType } from "@/types/vendor";
import translate from "@/utils/helpers/translate";

const vendorTypes: LocalizedEntity<VendorType> = {
  current: {
    value: "current",
    label: {
      en: "Current",
      ar: "متداول",
    },
  },
  equity: {
    value: "equity",
    label: {
      en: "Equity",
      ar: "مساهم",
    },
  },
};

export default vendorTypes;

export const vendorTypesArray = Object.values(vendorTypes);

// ================ Helpers ================

export const getVendorTypeLabel = (vendorType: VendorType, language: Language) => {
  return translate(language, vendorTypes[vendorType].label.en, vendorTypes[vendorType].label.ar);
};

export function isCurrentVendor(vendorType: VendorType) {
  return vendorType === vendorTypes.current.value;
}

export function isEquityVendor(vendorType: VendorType) {
  return vendorType === vendorTypes.equity.value;
}
