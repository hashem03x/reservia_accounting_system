import { useLanguage } from "@/context/LanguageContext";
import translate from "@/utils/helpers/translate";
import { useEffect, useState } from "react";
import useFetchingStatus from "@/hooks/useFetchingStatus";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import handleRequest from "@/utils/helpers/handle-request";
import { useWarehouses } from "@/context/WarehousesContext";
import { useSearchParams } from "react-router-dom";
import Box from "./box";
import { Link } from "react-router-dom";
import paths from "@/utils/constants/paths";
import { TopSellingProduct } from "@/types/analytics";
import { formatCurrency } from "@/utils/helpers/format-currency";

export default function TopSellingProducts({ height }: { height: string }) {
  const { language } = useLanguage();
  const { data: warehouses = [] } = useWarehouses();
  const [searchParams, setSearchParams] = useSearchParams();
  const warehouseId = searchParams.get("warehouseId") || "";

  const [data, setData] = useState<TopSellingProduct[] | null>(null);
  const { loading, setLoading, error, setError } = useFetchingStatus();
  const privateRequest = usePrivateRequest();

  const updateFilter = (key: string, value: string | null) => {
    const newSearchParams = new URLSearchParams(searchParams);
    if (value) {
      newSearchParams.set(key, value);
    } else {
      newSearchParams.delete(key);
    }
    setSearchParams(newSearchParams);
  };

  useEffect(() => {
    const controller = new AbortController();
    const canceled = { current: false };

    const executeFetch = async () => {
      const response = await privateRequest({
        url: `analytics/top-selling-products${warehouseId ? `?warehouseId=${warehouseId}` : ''}`,
        signal: controller.signal,
        language,
      });
      if (!canceled.current) {
        setData(response.data);
      }
    };

    handleRequest(language, setLoading, setError, executeFetch, canceled);

    return () => {
      controller.abort();
      canceled.current = true;
    };
  }, [warehouseId]);

  return (
    <Box height={height}>
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold">{translate(language, "Top Selling Products", "أفضل المنتجات مبيعًا")}</h3>
        <select
          value={warehouseId}
          onChange={(e) => updateFilter("warehouseId", e.target.value)}
          className="border rounded px-2 py-1"
        >
          <option value="">{translate(language, "All Warehouses", "جميع المستودعات")}</option>
          {warehouses.map((warehouse) => (
            <option key={warehouse._id} value={warehouse._id}>
              {warehouse.name}
            </option>
          ))}
        </select>
      </div>
      <div className="hide-scrollbar flex flex-1 animate-fade-in flex-col gap-3 overflow-y-auto">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <div className="h-32 w-32 animate-spin rounded-full border-b-2 border-t-2 border-gray-900"></div>
          </div>
        ) : error ? (
          <div className="flex h-full flex-col items-center justify-center gap-4">
            <p className="text-red-500">{error}</p>
          </div>
        ) : !data || data.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4">
            <p className="text-gray-500">
              {translate(language, "No data available", "لا توجد بيانات متاحة")}
            </p>
          </div>
        ) : (
          data.slice(0, 10).map((product, index) => (
            <div
              key={product._id}
              className="flex items-center justify-between gap-2 rounded-md border border-gray-100 bg-gray-50 p-3 shadow"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <Link
                  to={`/${paths.products}/${product._id}`}
                  className="truncate text-sm font-bold text-gray-800 hover:text-gray-600"
                >
                  {index + 1}. {translate(language, product.title.en, product.title.ar)}
                </Link>
                <p className="text-sm text-gray-600">
                  {translate(language, "Revenue", "الربح")}: {formatCurrency(product.revenue, language)} {translate(language, "EGP", "ج.م")}
                </p>
              </div>
              <span
                title={translate(language, "Total Sold", "إجمالي المبيعات")}
                className="rounded-full bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-800"
              >
                {product.totalSold}
              </span>
            </div>
          ))
        )}
      </div>
    </Box>
  );
}
