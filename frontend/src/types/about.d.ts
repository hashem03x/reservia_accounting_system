import { ContextProps } from "@/types/global";

export type About = {
  _id: string;
  logo: string;
  title: {
    en: string;
    ar: string;
  };
  content: {
    en: string;
    ar: string;
  };
  socialLinks: {
    facebook: string;
    instagram: string;
    twitter: string;
    whatsapp: string;
    tiktok: string;
  };
  homeSubcategories: string[];
  barcodeSittings: { subcategory: boolean; color: boolean; size: boolean };
} | null;

export type AboutContextProps = ContextProps<About>;
