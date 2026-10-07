import { useLanguage } from "@/context/LanguageContext";
import { useEffect, useState } from "react";
import useFetchingStatus from "@/hooks/useFetchingStatus";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import handleRequest from "@/utils/helpers/handle-request";
import translate from "@/utils/helpers/translate";
import { WarehousesBalanceType } from "@/types/analytics";
import { useSearchParams } from "react-router-dom";
import { useWarehouses } from "@/context/WarehousesContext";
import Box from "./box";
import ErrorSection from "@/components/ui/sections/error";
import Loader from "./loader";

interface WarehousesBalanceProps {
  height: string;
}

interface CurrencyBoxProps {
  title: string;
  value: number | string;
  className?: string;
  color?: string;
}

function CurrencyBox({ title, value, className = "", color = "blue" }: CurrencyBoxProps) {
  return (
    <div className={`rounded-lg bg-${color}-50 p-3 ${className}`}>
      <p className={`text-sm font-medium text-${color}-600`}>{title}</p>
      <p className={`text-lg font-bold text-${color}-800`}>{value}</p>
    </div>
  );
}

export default function WarehousesBalance({ height }: WarehousesBalanceProps) {
  const { language } = useLanguage();
  const { data: warehouses = [] } = useWarehouses();
  const [data, setData] = useState<WarehousesBalanceType | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  const startDateParam = searchParams.get("startDate");
  const endDateParam = searchParams.get("endDate");
  const warehouseId = searchParams.get("warehouseId") || "";

  const startDate = startDateParam !== null ? startDateParam : "";
  const endDate = endDateParam !== null ? endDateParam : "";

  const updateFilter = (key: string, value: string | null) => {
    const newSearchParams = new URLSearchParams(searchParams);
    if (value !== null) {
      newSearchParams.set(key, value);
    } else {
      newSearchParams.set(key, "");
    }
    setSearchParams(newSearchParams);
  };

  const { loading, setLoading, error, setError } = useFetchingStatus();
  const privateRequest = usePrivateRequest();

  function getData() {
    const controller = new AbortController();
    const canceled = { current: false };

    const executeFetch = async () => {
      const response = await privateRequest({
        url: `analytics/warehouses-balance?startDate=${startDate}&endDate=${endDate}${warehouseId ? `&warehouseId=${warehouseId}` : ""}`,
        signal: controller.signal,
        language,
      });
      setData(response.data);
    };

    handleRequest(language, setLoading, setError, executeFetch, canceled);

    return () => {
      controller.abort();
      canceled.current = true;
    };
  }

  useEffect(() => {
    const cancelRequest = getData();
    return cancelRequest;
  }, [startDate, endDate, warehouseId, language]);

  return (
    <Box height={height}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="mb-1">{translate(language, "Warehouses Balance", "رصيد المستودعات")}</h3>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-sm">{translate(language, "Start Date", "تاريخ البداية")}:</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => updateFilter("startDate", e.target.value)}
              className="rounded-md border border-gray-300 px-2 py-1 text-sm"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm">{translate(language, "End Date", "تاريخ النهاية")}:</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => updateFilter("endDate", e.target.value)}
              className="rounded-md border border-gray-300 px-2 py-1 text-sm"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm">{translate(language, "Warehouse", "المخزن")}:</label>
            <select
              value={warehouseId}
              onChange={(e) => updateFilter("warehouseId", e.target.value)}
              className="rounded-md border border-gray-300 px-2 py-1 text-sm"
            >
              <option value="">{translate(language, "All Warehouses", "جميع المخازن")}</option>
              {warehouses?.map((warehouse) => (
                <option key={warehouse._id} value={warehouse._id}>
                  {warehouse.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {loading ? (
        <Loader />
      ) : error ? (
        <ErrorSection
          errorTitle={translate(language, "Error Loading Balance", "خطأ في تحميل الرصيد")}
          errorMessage={error}
          button={{ text: translate(language, "Try Again", "حاول مرة أخرى"), onClick: getData }}
        />
      ) : (
        data && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            <CurrencyBox
              title={translate(language, "Total Balance For All Currencies (EGP)", "(EGP) الرصيد الإجمالي لكل العملات")}
              value={data.totalBalanceForAllCurrencies.toFixed(2)}
              color="green"
              className="col-span-full"
            />
            <CurrencyBox
              title={translate(language, "Total Balance (EGP)", "(EGP) الرصيد الإجمالي")}
              value={data.totalBalance}
              color="blue"
              className="col-span-full"
            />
            <CurrencyBox title="USD" value={data.USD} color="green" />
            <CurrencyBox title="EUR" value={data.EUR} color="yellow" />
            <CurrencyBox title="TRY" value={data.TRY} color="purple" />
            <CurrencyBox title="CNY" value={data.CNY} color="pink" />
          </div>
        )
      )}
    </Box>
  );
}
