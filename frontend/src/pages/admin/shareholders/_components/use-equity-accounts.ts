import { useEffect } from "react";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import { ChartOfAccountRef } from "@/types/orders";

// The Chart of Accounts equity accounts (type 'equity'), from the server.
export default function useEquityAccounts(enabled: boolean) {
  const { language } = useLanguage();
  const { privateRequest, data, setData } = useDataHandler<ChartOfAccountRef[]>({ initialData: [] });
  useEffect(() => {
    if (!enabled || data.length) return;
    privateRequest({ url: "shareholders/equity-accounts", language })
      .then((res) => setData(res.data))
      .catch(() => setData([]));
  }, [enabled]);
  return data;
}
