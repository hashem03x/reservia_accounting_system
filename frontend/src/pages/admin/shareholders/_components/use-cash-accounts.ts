import { useEffect } from "react";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import { ChartOfAccountRef } from "@/types/orders";

// The Chart of Accounts Cash/Cash-Equivalent accounts, from the server - same endpoint
// components/global/payment-account-select uses, fetched directly here (rather than through that
// component) since add-contribution-modal.tsx needs the raw list to find one fixed account by
// code, not an editable Select.
export default function useCashAccounts(enabled: boolean) {
  const { language } = useLanguage();
  const { privateRequest, data, setData } = useDataHandler<ChartOfAccountRef[]>({ initialData: [] });
  useEffect(() => {
    if (!enabled || data.length) return;
    privateRequest({ url: "accounts/cash-equivalent-eligible", language })
      .then((res) => setData(res.data))
      .catch(() => setData([]));
  }, [enabled]);
  return data;
}
