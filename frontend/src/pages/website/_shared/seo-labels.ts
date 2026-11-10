import { SeoSource, SeoWarning, WebsiteLocale } from "@/types/website";

// Website Management - human wording for the backend SEO resolver's codes
// (backend/server/utils/website/seoResolver.js). `level` drives the badge colour: a "problem" blocks
// good search results, a "notice" is informational (e.g. a generated default the editor may keep).

export const SEO_WARNING_LABELS: Record<SeoWarning, { en: string; ar: string; level: "problem" | "notice" }> = {
  missing_title: { en: "No title", ar: "لا يوجد عنوان", level: "problem" },
  title_generated: { en: "Title generated from content", ar: "العنوان مُولّد من المحتوى", level: "notice" },
  title_too_long: { en: "Title longer than 60 characters", ar: "العنوان أطول من 60 حرفًا", level: "problem" },
  missing_description: { en: "No description", ar: "لا يوجد وصف", level: "problem" },
  description_generated: { en: "Description generated", ar: "الوصف مُولّد تلقائيًا", level: "notice" },
  description_too_long: { en: "Description longer than 160 characters", ar: "الوصف أطول من 160 حرفًا", level: "problem" },
  description_too_short: { en: "Description shorter than 50 characters", ar: "الوصف أقصر من 50 حرفًا", level: "problem" },
  canonical_overridden: { en: "Canonical points to another URL", ar: "الرابط الأساسي يشير لرابط آخر", level: "notice" },
  noindex: { en: "Hidden from search (noindex)", ar: "مخفية عن البحث (noindex)", level: "notice" },
  duplicate_title: { en: "Same title as another page", ar: "نفس عنوان صفحة أخرى", level: "problem" },
  duplicate_description: { en: "Same description as another page", ar: "نفس وصف صفحة أخرى", level: "problem" },
};

export const SEO_SOURCE_LABELS: Record<SeoSource, { en: string; ar: string }> = {
  custom: { en: "Written by an editor", ar: "كتبه محرر" },
  content: { en: "Generated from the page content", ar: "مُولّد من محتوى الصفحة" },
  site_default: { en: "Site default", ar: "الافتراضي للموقع" },
  website: { en: "The website's own text (unchanged)", ar: "نص الموقع الحالي (بدون تغيير)" },
  none: { en: "Missing", ar: "غير موجود" },
};

export const LOCALE_LABELS: Record<WebsiteLocale, { en: string; ar: string }> = {
  ar: { en: "Arabic", ar: "العربية" },
  en: { en: "English", ar: "الإنجليزية" },
};

/** "Ar" / "En" - the suffix of every bilingual field (titleAr, titleEn...). */
export const localeSuffix = (l: WebsiteLocale) => (l === "ar" ? "Ar" : "En");
