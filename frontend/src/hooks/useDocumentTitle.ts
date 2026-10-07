import { useEffect } from "react";
import { useLanguage } from "@/context/LanguageContext";

export default function useDocumentTitle(title: string, defaultTitle: string = ""): void {
  const { translations } = useLanguage();

  defaultTitle = defaultTitle || translations.appName;

  useEffect(() => {
    document.title = title;
    return () => {
      document.title = defaultTitle;
    };
  }, [title, defaultTitle]);
}
