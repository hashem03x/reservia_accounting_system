import { useEffect } from "react";
import { Select } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import { ChartOfAccountRef } from "@/types/orders";

// Loads the active, type:'liability' Chart of Accounts accounts directly from the backend
// (`GET expenses/liability-account-options`) - never a hardcoded options list, mirroring
// payment-account-select's pattern so this component can never disagree with the server-side
// validation that runs on submit.
export default function LiabilityAccountSelect({
  value,
  onChange,
  label,
  required,
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  required?: boolean;
}) {
  const { translate, language } = useLanguage();
  const { privateRequest, data: accounts, setData: setAccounts } = useDataHandler<ChartOfAccountRef[]>({ initialData: [] });

  useEffect(() => {
    privateRequest({ url: "expenses/liability-account-options", language })
      .then(res => setAccounts(res.data))
      .catch(() => setAccounts([]));
  }, []);

  return (
    <Select
      label={label ?? translate("Liability Account", "حساب الخصم")}
      placeholder={accounts.length === 0 ? translate("No liability accounts configured", "لا توجد حسابات خصوم مُعدة") : translate("Select a liability account", "اختر حساب الخصم")}
      value={value || null}
      onChange={v => onChange(v || "")}
      data={accounts.map(a => ({ value: a._id, label: `${a.code} - ${a.name}` }))}
      searchable
      required={required}
      disabled={accounts.length === 0}
      nothingFoundMessage={translate(
        "No eligible accounts - add a liability account in Chart of Accounts first.",
        "لا توجد حسابات مؤهلة - أضف حساب خصوم في دليل الحسابات أولاً.",
      )}
    />
  );
}
