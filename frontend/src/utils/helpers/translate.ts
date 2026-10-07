import { Language } from "@/types/language";

export default function translate(language: Language, english: string, arabic: string): string {
  return language === "ar-EG" ? arabic : english;
}
