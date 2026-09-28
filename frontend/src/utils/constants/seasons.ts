import { Language } from "@/types/language";
import { LocalizedEntity } from "@/types/global";
import { Season } from "@/types/product";
import translate from "@/utils/helpers/translate";

const seasons: LocalizedEntity<Season> = {
  all: {
    value: "all",
    label: {
      en: "Both",
      ar: "كلاهما",
    },
  },
  summer: {
    value: "summer",
    label: {
      en: "Summer",
      ar: "صيفي",
    },
  },
  winter: {
    value: "winter",
    label: {
      en: "Winter",
      ar: "شتوي",
    },
  },
};

export default seasons;

export const seasonsArray = Object.values(seasons);

// ================ Helpers ================

export const getSeasonLabel = (season: Season, language: Language) => {
  return translate(language, seasons[season].label.en, seasons[season].label.ar);
};
