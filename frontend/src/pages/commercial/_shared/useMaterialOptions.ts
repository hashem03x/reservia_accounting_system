import { useEffect, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import { MaterialItem } from "@/types/commercial";

/** Select options for one Price Book category, e.g. "PV Modules" - always the live, centralized catalog, never a hardcoded list. */
export default function useMaterialOptions(category: string) {
  const { language } = useLanguage();
  const privateRequest = usePrivateRequest();
  const [items, setItems] = useState<MaterialItem[]>([]);

  useEffect(() => {
    let canceled = false;
    privateRequest({ url: "commercial/materials", params: { category, limit: "200" }, language })
      .then((res) => {
        if (!canceled) setItems(res.data as MaterialItem[]);
      })
      .catch(() => {});
    return () => {
      canceled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);

  return items;
}
