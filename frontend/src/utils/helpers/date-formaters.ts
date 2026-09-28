import { Language } from "@/types/language";

export function formatDate(date: number | string | Date, language: Language) {
  return new Date(date).toLocaleDateString(language, { day: "numeric", month: "short", year: "numeric" });
}

export function formatDateAndTime(date: number | string | Date, language: Language) {
  return new Date(date).toLocaleString(language, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "numeric",
  });
}
