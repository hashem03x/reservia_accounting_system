import { Language } from "@/types/language";
import { LocalizedEntity } from "@/types/global";
import { TransferType } from "@/types/transfer";
import translate from "@/utils/helpers/translate";

const transferTypes: LocalizedEntity<TransferType> = {
  product: {
    value: "product",
    label: {
      en: "Entire Product",
      ar: "المنتج بالكامل",
    },
  },
  variants: {
    value: "variants",
    label: {
      en: "Specific Variants",
      ar: "أصناف محددة",
    },
  },
};

export default transferTypes;

export const transferTypesArray = Object.values(transferTypes);

// ================ Helpers ================

export const getTransferTypeLabel = (type: TransferType, language: Language) => {
  return translate(language, transferTypes[type].label.en, transferTypes[type].label.ar);
};
