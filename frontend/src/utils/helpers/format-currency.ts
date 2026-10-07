import { Language } from "@/types/language";

export function formatCurrency(amount: number | null | undefined, language: Language = "en-US"): string {
  if (amount === null || amount === undefined) return "N/A";
  return new Intl.NumberFormat(language, {
    style: "currency",
    currency: "EGP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}
