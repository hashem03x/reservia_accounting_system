import { useEffect } from "react";
import { Select } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import { ChartOfAccount } from "@/types/chart-of-account";

/** Eligible WIP (PUC) accounts from the backend (`GET accounts/puc-eligible`, ordered by account
 * number) - the same eligibility rule the server validates `wipAccount` against. Only fetched while
 * `enabled` (the form is open on a COGS account). */
export function useWipAccountOptions(enabled: boolean) {
  const { language } = useLanguage();
  const { privateRequest, data, setData } = useDataHandler<ChartOfAccount[]>({ initialData: [] });

  useEffect(() => {
    if (!enabled) return;
    privateRequest({ url: "accounts/puc-eligible", language })
      .then((res) => setData(Array.isArray(res?.data) ? res.data : []))
      .catch(() => setData([]));
  }, [enabled]);

  return data || [];
}

/** COGS accounts only: the WIP (PUC) account a Sales Order's project cost recognition credits for
 * this cost category. Optional - the backend's built-in COGS -> WIP map covers the original pairs. */
export default function WipAccountSelect({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: ChartOfAccount[] }) {
  const { translate } = useLanguage();

  return (
    <Select
      label={translate("WIP (PUC) Account", "حساب مشروعات تحت التنفيذ")}
      description={translate(
        "The Projects-Under-Construction account this cost is moved out of when a Sales Order recognizes project cost. Leave empty to use the built-in mapping.",
        "حساب مشروعات تحت التنفيذ الذي تُحمّل منه هذه التكلفة عند الاعتراف بتكلفة المشروع من أمر البيع. اتركه فارغاً لاستخدام الربط الافتراضي."
      )}
      placeholder={translate("Built-in mapping", "الربط الافتراضي")}
      value={value || null}
      onChange={(v) => onChange(v || "")}
      data={options.map((a) => ({ value: a._id, label: `${a.code} - ${a.name}` }))}
      searchable
      clearable
    />
  );
}
