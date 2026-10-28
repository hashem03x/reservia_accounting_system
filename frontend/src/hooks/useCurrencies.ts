import { useCallback, useEffect, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import { Currency, CurrencyInput, CurrencyRateForDate } from "@/types/currency";
import handleRequest from "@/utils/helpers/handle-request";
import { Language } from "@/types/language";

export type CurrencyStatusFilter = "all" | "active" | "inactive";
export type CurrencyQuery = {
  keyword?: string;
  status?: CurrencyStatusFilter;
  sort?: string;
  page?: number;
  limit?: number;
};
type Pagination = { currentPage: number; numberOfPages: number; limit: number };

/**
 * The one data layer for the Currency Manager (`/currencies` API), shared by the Currencies page and
 * the Journal Entry currency selector. Search, status filter, sorting and pagination run on the
 * server. Mutations throw the backend's error (duplicate code, base-currency rules, a concurrent
 * edit) for the caller to show via handleRequest, and reload the list on success.
 *
 * Rate convention: 1 EGP = unitsPerBase units of the currency.
 */
export default function useCurrencies(query: CurrencyQuery = {}) {
  const { language } = useLanguage();
  const privateRequest = usePrivateRequest();
  const { keyword = "", status = "all", sort = "code", page = 1, limit = 20 } = query;

  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ currentPage: 1, numberOfPages: 1, limit });
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const reload = useCallback(
    () =>
      handleRequest(language, setLoading, setError, async () => {
        const res = await privateRequest({
          url: "currencies",
          params: { ...(keyword.trim() ? { keyword: keyword.trim() } : {}), status, sort, page, limit },
          language,
        });
        setCurrencies(Array.isArray(res?.data) ? res.data : []);
        setPagination(res?.paginationResult ?? { currentPage: 1, numberOfPages: 1, limit });
        setTotalCount(res?.totalCount ?? 0);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [language, keyword, status, sort, page, limit],
  );

  useEffect(() => {
    reload();
  }, [reload]);

  async function getCurrency(idOrCode: string): Promise<Currency> {
    const res = await privateRequest({ url: `currencies/${idOrCode}`, language });
    return res.data as Currency;
  }

  async function createCurrency(input: CurrencyInput): Promise<Currency> {
    const res = await privateRequest({ url: "currencies", method: "POST", data: input, language });
    await reload();
    return res.data as Currency;
  }

  async function updateCurrency(id: string, input: CurrencyInput): Promise<Currency> {
    const res = await privateRequest({ url: `currencies/${id}`, method: "PATCH", data: input, language });
    await reload();
    return res.data as Currency;
  }

  async function deleteCurrency(id: string): Promise<void> {
    await privateRequest({ url: `currencies/${id}`, method: "DELETE", language });
    await reload();
  }

  return {
    currencies,
    pagination,
    totalCount,
    loading,
    error,
    reload,
    getCurrency,
    createCurrency,
    updateCurrency,
    deleteCurrency,
  };
}

/** The rate a transaction in `code` on `date` (YYYY-MM-DD, default today) gets by default. */
export async function fetchRateForDate(
  privateRequest: ReturnType<typeof usePrivateRequest>,
  code: string,
  date: string | undefined,
  language: Language,
): Promise<CurrencyRateForDate> {
  const res = await privateRequest({ url: `currencies/${code}/rate`, params: date ? { date } : {}, language });
  return res.data as CurrencyRateForDate;
}
