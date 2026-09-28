import { Language } from "@/types/language";
import { LocalizedEntity } from "@/types/global";
import { Color } from "@/types/product";
import translate from "@/utils/helpers/translate";

const colors: LocalizedEntity<Color> = {
  black: {
    value: "black",
    label: {
      en: "Black",
      ar: "أسود",
    },
  },
  white: {
    value: "white",
    label: {
      en: "White",
      ar: "أبيض",
    },
  },
  red: {
    value: "red",
    label: {
      en: "Red",
      ar: "أحمر",
    },
  },
  green: {
    value: "green",
    label: {
      en: "Green",
      ar: "أخضر",
    },
  },
  blue: {
    value: "blue",
    label: {
      en: "Blue",
      ar: "أزرق",
    },
  },
  yellow: {
    value: "yellow",
    label: {
      en: "Yellow",
      ar: "أصفر",
    },
  },
  orange: {
    value: "orange",
    label: {
      en: "Orange",
      ar: "برتقالي",
    },
  },
  brown: {
    value: "brown",
    label: {
      en: "Brown",
      ar: "بني",
    },
  },
  cream: {
    value: "cream",
    label: {
      en: "Off White",
      ar: "أبيض عاجي",
    },
  },
  olive: {
    value: "olive",
    label: {
      en: "Olive",
      ar: "زيتوني",
    },
  },
  navy: {
    value: "navy",
    label: {
      en: "Navy",
      ar: "كحلي",
    },
  },
  pink: {
    value: "pink",
    label: {
      en: "Pink",
      ar: "وردي",
    },
  },
  gray: {
    value: "gray",
    label: {
      en: "Gray",
      ar: "رمادي",
    },
  },
  purple: {
    value: "purple",
    label: {
      en: "Purple",
      ar: "بنفسجي",
    },
  },
  coffee: {
    value: "coffee",
    label: {
      en: "Coffee",
      ar: "قهوي",
    },
  },
  beige: {
    value: "beige",
    label: {
      en: "Beige",
      ar: "بيج",
    },
  },
  khaki: {
    value: "khaki",
    label: {
      en: "Khaki",
      ar: "كاكي",
    },
  },
  gold: {
    value: "gold",
    label: {
      en: "Gold",
      ar: "ذهبي",
    },
  },
  silver: {
    value: "silver",
    label: {
      en: "Silver",
      ar: "فضي",
    },
  },
  maroon: {
    value: "maroon",
    label: {
      en: "Maroon",
      ar: "عنابي",
    },
  },
  teal: {
    value: "teal",
    label: {
      en: "Teal",
      ar: "تركواز",
    },
  },
};

export default colors;

export const colorsArray = Object.values(colors);

// ================ Helpers ================

export const getColorLabel = (color: Color, language: Language) => {
  // If the color doesn't exist in our predefined colors, return the color name itself
  if (!colors[color]) {
    console.warn(`Color "${color}" not found in predefined colors`);
    return color;
  }
  return translate(language, colors[color].label.en, colors[color].label.ar);
};
