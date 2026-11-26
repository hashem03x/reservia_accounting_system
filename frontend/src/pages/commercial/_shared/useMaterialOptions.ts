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

/** A Price Book item the design engines can size with: not PLACEHOLDER and no technical data missing. */
export const isEngineReady = (m: MaterialItem) => m.status !== "PLACEHOLDER" && !(m.missingSpecs && m.missingSpecs.length);

/**
 * Select options for an engine input (PV module, inverter). Items still missing technical data are
 * listed but disabled, marked "needs technical data", so the estimator sees them without being able
 * to pick one the calculation would refuse ("PV module ... cannot be used in a calculation yet").
 */
export function engineSelectData(items: MaterialItem[], unit: string, needsData: string) {
  return items.map((m) => {
    const ready = isEngineReady(m);
    return { value: m.model, label: `${m.brand} ${m.model} (${m.n1 ?? "?"}${unit})${ready ? "" : ` - ${needsData}`}`, disabled: !ready };
  });
}
