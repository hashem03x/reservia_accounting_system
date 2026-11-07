import { CommercialCategory } from "@/types/commercial";

// Shared Arabic labels for the 6 Commercial categories - mirrors utils/crm/_shared/stage.ts's
// pattern (a single translate-aware label function reused across every page) rather than
// repeating the same if/else per page.
const LABELS: Record<CommercialCategory, { en: string; ar: string }> = {
  "On-Grid C&I": { en: "On-Grid C&I", ar: "ربط بالشبكة" },
  "Off-Grid": { en: "Off-Grid", ar: "خارج الشبكة" },
  "Agriculture Pumping": { en: "Agriculture Pumping", ar: "ضخ مياه زراعي" },
  "Utility Scale": { en: "Utility Scale", ar: "محطات كبرى" },
  "Street Lighting": { en: "Street Lighting", ar: "إنارة الشوارع" },
  "Solar Water Heating": { en: "Solar Water Heating", ar: "سخانات شمسية" },
};

export function categoryLabel(translate: (en: string, ar: string) => string) {
  return (category: CommercialCategory | string) => {
    const l = LABELS[category as CommercialCategory];
    return l ? translate(l.en, l.ar) : category;
  };
}
