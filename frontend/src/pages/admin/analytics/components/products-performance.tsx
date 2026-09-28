import { useEffect, useState, useCallback } from "react";
import { Chart as ChartJS, ArcElement, Tooltip, Legend, TooltipItem } from "chart.js";
import { Doughnut } from "react-chartjs-2";
import { useLanguage } from "@/context/LanguageContext";
import translate from "@/utils/helpers/translate";
import useFetchingStatus from "@/hooks/useFetchingStatus";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import handleRequest from "@/utils/helpers/handle-request";
import Box from "./box";
import { ProductPerformance } from "@/types/analytics";
import { useSearchParams } from "react-router-dom";
import { useWarehouses } from "@/context/WarehousesContext";

ChartJS.register(ArcElement, Tooltip, Legend);

type ProductsPerformanceType = ProductPerformance[];

const MAX_ITEMS = 5;

export default function ProductsPerformance({ height }: { height: string }) {
  const { language } = useLanguage();
  const { data: warehouses = [] } = useWarehouses();
  const [searchParams, setSearchParams] = useSearchParams();
  const warehouseId = searchParams.get("warehouseId") || "";

  const startDateParam = searchParams.get("startDate");
  const endDateParam = searchParams.get("endDate");
  const startDate = startDateParam !== null ? startDateParam : "";
  const endDate = endDateParam !== null ? endDateParam : "";

  const [data, setData] = useState<ProductsPerformanceType | null>(null);
  const { loading, setLoading, error, setError } = useFetchingStatus();
  const privateRequest = usePrivateRequest();

  const updateFilter = (key: string, value: string | null) => {
    const newSearchParams = new URLSearchParams(searchParams);
    if (value !== null && value !== "") {
      newSearchParams.set(key, value);
    } else {
      newSearchParams.delete(key);
    }
    setSearchParams(newSearchParams);
  };

  const getData = useCallback(() => {
    const controller = new AbortController();
    const canceled = { current: false };

    const executeFetch = async () => {
      const response = await privateRequest({
        url: "analytics/product-performance",
        signal: controller.signal,
        language,
        params: {
          warehouseId: warehouseId || '',
          startDate: startDate || '',
          endDate: endDate || ''
        }
      });
      setData(response.data || null);
    };

    handleRequest(language, setLoading, setError, executeFetch, canceled);

    return () => {
      controller.abort();
      canceled.current = true;
    };
  }, [language, privateRequest, setLoading, setError, warehouseId, startDate, endDate]);

  useEffect(() => {
    const cancelRequest = getData();
    return cancelRequest;
  }, [warehouseId, startDate, endDate, language]);

  const createChartData = (data: ProductsPerformanceType, key: keyof ProductPerformance) => {
    const labels = data.slice(0, MAX_ITEMS).map((item) => translate(language, item.title.en, item.title.ar));
    const datasetData = data.slice(0, MAX_ITEMS).map((item) => item[key] as number);

    return {
      labels,
      datasets: [
        {
          data: datasetData,
          backgroundColor: ["#E94144", "#F3722C", "#F8961E", "#F9C74F", "#90BE6D", "#43AA8B", "#577590"],
          borderRadius: 3,
          key, // Keep the key in the context of the dataset for use in tooltip
        },
      ],
    };
  };

  // Define a type for our custom dataset that includes the key property
  interface CustomDataset {
    key: keyof ProductPerformance;
    data: number[];
    backgroundColor: string[];
    borderRadius: number;
  }

  const globalOptions = {
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        padding: 10,
        displayColors: false,
        bodyFont: { size: 12 },
        callbacks: {
          label: function(tooltipItem: TooltipItem<"doughnut">) {
            // Access the dataset and get the key
            const dataset = tooltipItem.dataset as unknown as CustomDataset;
            const key = dataset.key;

            // Define the translations based on the key and current language
            const labelTranslations: Record<string, string> = {
              totalSold: translate(language, "Total Sold", "إجمالي المبيعات"),
              revenue: translate(language, "Revenue", "الإيرادات"),
            };

            const label = labelTranslations[key] || ""; // Use key to find the appropriate label translation
            const value = tooltipItem.raw as number || 0;
            return `${label}: ${value}`;
          },
        },
      },
    },
  };

  return (
    <Box height={height}>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold">
          {translate(language, "Products Performance", "أداء المنتجات")}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <label className="text-xs">{translate(language, "Start", "البداية")}:</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => updateFilter("startDate", e.target.value)}
              className="border rounded px-1 py-1 text-xs"
            />
          </div>
          <div className="flex items-center gap-1">
            <label className="text-xs">{translate(language, "End", "النهاية")}:</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => updateFilter("endDate", e.target.value)}
              className="border rounded px-1 py-1 text-xs"
            />
          </div>
          <select
            value={warehouseId}
            onChange={(e) => updateFilter("warehouseId", e.target.value)}
            className="border rounded px-2 py-1 text-xs"
          >
            <option value="">{translate(language, "All Warehouses", "جميع المستودعات")}</option>
            {warehouses.map((warehouse) => (
              <option key={warehouse._id} value={warehouse._id}>
                {warehouse.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="hide-scrollbar flex flex-1 animate-fade-in flex-col gap-4 overflow-y-auto">
        {/* <h3 className="mb-1">{translate(language, "Products Performance", "أداء المنتجات")}</h3> */}
        <p className="mb-4 text-xs sm:text-sm">
          {translate(
            language,
            "Analyze product performance based on sales and revenue metrics.",
            "تحليل أداء المنتجات بناءً على مقاييس المبيعات والإيرادات."
          )}
        </p>

        {loading ? (
          <div className="animate-pulse flex items-center justify-center h-full">
            <div className="w-8 h-8 border-2 border-gray-300 rounded-full animate-spin"></div>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center text-red-500 h-full">
            <div className="text-center">
              <p className="text-lg font-medium mb-2">
                {translate(language, "Error Loading Data", "خطأ في تحميل البيانات")}
              </p>
              <p className="text-sm">{error}</p>
              <button 
                onClick={getData} 
                className="mt-4 px-4 py-2 bg-red-100 text-red-700 rounded-md hover:bg-red-200"
              >
                {translate(language, "Try Again", "حاول مرة أخرى")}
              </button>
            </div>
          </div>
        ) : !data || data.length === 0 ? (
          <div className="flex items-center justify-center text-gray-500 h-full">
            <div className="text-center">
              <p className="text-lg font-medium">
                {translate(language, "No Data Available", "لا توجد بيانات متاحة")}
              </p>
              <p className="text-sm mt-2">
                {translate(language, "Try again later", "حاول مرة أخرى لاحقاً")}
              </p>
              <button 
                onClick={getData} 
                className="mt-4 px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200"
              >
                {translate(language, "Refresh Data", "تحديث البيانات")}
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="bg-gray-50 p-4 rounded flex flex-col items-center">
              <h3 className="font-semibold mb-4 text-center">
                {translate(language, "Total Sold", "إجمالي المبيعات")}
              </h3>
              <div className="aspect-square w-full max-w-[250px]">
                <Doughnut data={createChartData(data, "totalSold")} options={globalOptions} />
              </div>
            </div>
            <div className="bg-gray-50 p-4 rounded flex flex-col items-center">
              <h3 className="font-semibold mb-4 text-center">
                {translate(language, "Revenue", "الإيرادات")}
              </h3>
              <div className="aspect-square w-full max-w-[250px]">
                <Doughnut data={createChartData(data, "revenue")} options={globalOptions} />
              </div>
            </div>
          </div>
        )}
      </div>
    </Box>
  );
}
