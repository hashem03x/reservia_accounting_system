import { useLanguage } from "@/context/LanguageContext";
import translate from "@/utils/helpers/translate";
import { useEffect, useState } from "react";
import useFetchingStatus from "@/hooks/useFetchingStatus";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import handleRequest from "@/utils/helpers/handle-request";
import ErrorSection from "@/components/ui/sections/error";
import Loader from "./loader";
import Box from "./box";
import { useWarehouses } from "@/context/WarehousesContext";
import { useSearchParams } from "react-router-dom";
import { ProductAvailability as ProductAvailabilityType } from "@/types/analytics";

export default function ProductAvailability({ height }: { height: string }) {
  const { language } = useLanguage();
  const { data: warehouses = [] } = useWarehouses();
  const [data, setData] = useState<ProductAvailabilityType | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  const warehouseId = searchParams.get("warehouseId") || "";

  const updateFilter = (key: string, value: string | null) => {
    const newSearchParams = new URLSearchParams(searchParams);
    if (value) {
      newSearchParams.set(key, value);
    } else {
      newSearchParams.delete(key);
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
        url: `analytics/product-availability${warehouseId ? `?warehouseId=${warehouseId}` : ''}`,
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
  }, [searchParams]);

  return (
    <Box height={height}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="mb-1">{translate(language, "Product Availability", "توفر المنتجات")}</h3>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-sm">{translate(language, "Warehouse", "المخزن")}:</label>
            <select
              value={warehouseId}
              onChange={(e) => updateFilter("warehouseId", e.target.value)}
              className="border rounded px-2 py-1"
            >
              <option value="">{translate(language, "All Warehouses", "جميع المخازن")}</option>
              {warehouses?.map((warehouse) => (
                <option key={warehouse._id} value={warehouse._id}>{warehouse.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {loading ? (
        <Loader />
      ) : error ? (
        <ErrorSection
          errorTitle={translate(language, "Error Loading Data", "خطأ في تحميل البيانات")}
          errorMessage={error}
          button={{ text: translate(language, "Try Again", "حاول مرة أخرى"), onClick: getData }}
        />
      ) : (
        data && (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            <div className="rounded-lg bg-blue-50 p-3">
              <p className="text-sm font-medium text-blue-600">{translate(language, "Total Products", "إجمالي المنتجات")}</p>
              <p className="text-lg font-bold text-blue-800">{data.totalProducts}</p>
            </div>
            <div className="rounded-lg bg-green-50 p-3">
              <p className="text-sm font-medium text-green-600">{translate(language, "Available Products", "المنتجات المتوفرة")}</p>
              <p className="text-lg font-bold text-green-800">{data.availableProducts}</p>
            </div>
            <div className="rounded-lg bg-yellow-50 p-3">
              <p className="text-sm font-medium text-yellow-600">{translate(language, "Sold Products", "المنتجات المباعة")}</p>
              <p className="text-lg font-bold text-yellow-800">{data.soldProducts}</p>
            </div>
            <div className="rounded-lg bg-purple-50 p-3">
              <p className="text-sm font-medium text-purple-600">{translate(language, "Unsold Products", "المنتجات غير المباعة")}</p>
              <p className="text-lg font-bold text-purple-800">{data.unsoldProducts}</p>
            </div>
            <div className="rounded-lg bg-pink-50 p-3">
              <p className="text-sm font-medium text-pink-600">{translate(language, "Total Stock", "إجمالي المخزون")}</p>
              <p className="text-lg font-bold text-pink-800">{data.totalStock}</p>
            </div>
            <div className="rounded-lg bg-orange-50 p-3">
              <p className="text-sm font-medium text-orange-600">{translate(language, "Total Sold", "إجمالي المبيعات")}</p>
              <p className="text-lg font-bold text-orange-800">{data.totalSold}</p>
            </div>
          </div>
        )
      )}
    </Box>
  );
}