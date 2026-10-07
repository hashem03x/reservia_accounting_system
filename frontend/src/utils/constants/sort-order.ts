import { Language } from "@/types/language";
import { LocalizedEntity, SortOrder } from "@/types/global";
import translate from "@/utils/helpers/translate";

const sortOrders: LocalizedEntity<SortOrder> = {
  asc: {
    value: "asc",
    label: {
      en: "Ascending",
      ar: "تصاعدي",
    },
  },
  desc: {
    value: "desc",
    label: {
      en: "Descending",
      ar: "تنازلي",
    },
  },
};

export default sortOrders;

export const sortOrdersArray = Object.values(sortOrders);

// ================ Helpers ================

export const getSortOrderLabel = (sortOrder: SortOrder, language: Language) => {
  return translate(language, sortOrders[sortOrder].label.en, sortOrders[sortOrder].label.ar);
};
