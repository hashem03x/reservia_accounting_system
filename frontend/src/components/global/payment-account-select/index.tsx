import { useEffect } from "react";
import { Select } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import { ChartOfAccountRef } from "@/types/orders";

// Loads the eligible Cash/Cash-Equivalent accounts directly from the Chart of Accounts API (docs
// section "Payment Methods Must Come From Chart of Accounts") - never a hardcoded options list.
// The backend (`GET accounts/cash-equivalent-eligible`) is the single source of truth for which
// accounts qualify, so this component never implements its own eligibility logic and can never
// disagree with the server-side validation that runs on submit.
export default function PaymentAccountSelect({
  value,
  onChange,
  label,
  required,
  clearable,
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  required?: boolean;
  clearable?: boolean;
}) {
  const { translate, language } = useLanguage();
  const { privateRequest, data: accounts, setData: setAccounts } = useDataHandler<ChartOfAccountRef[]>({ initialData: [] });

  useEffect(() => {
    privateRequest({ url: "accounts/cash-equivalent-eligible", language })
      .then(res => setAccounts(res.data))
      .catch(() => setAccounts([]));
  }, []);

  return (
    <Select
      label={label ?? translate("Payment Account", "حساب الدفع")}
      placeholder={accounts.length === 0 ? translate("No Cash/Cash-Equivalent accounts configured", "لا توجد حسابات نقدية/ما يعادلها مُعدة") : translate("Select a Cash or Cash Equivalent account", "اختر حساب نقدية أو ما يعادله")}
      value={value || null}
      onChange={v => onChange(v || "")}
      data={accounts.map(a => ({ value: a._id, label: `${a.code} - ${a.name}` }))}
      searchable
      required={required}
      clearable={clearable}
      disabled={accounts.length === 0}
      nothingFoundMessage={translate(
        "No eligible accounts - classify an account as Cash or Cash Equivalent in Chart of Accounts first.",
        "لا توجد حسابات مؤهلة - قم بتصنيف حساب كنقدية أو ما يعادلها في دليل الحسابات أولاً.",
      )}
    />
  );
}
