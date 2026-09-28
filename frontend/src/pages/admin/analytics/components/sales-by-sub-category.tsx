import { useLanguage } from "@/context/LanguageContext";
import translate from "@/utils/helpers/translate";
import { useEffect, useState, useCallback } from "react";
import useFetchingStatus from "@/hooks/useFetchingStatus";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import handleRequest from "@/utils/helpers/handle-request";
import Box from "./box";
import { Bar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ChartOptions,
  TooltipItem,
} from "chart.js";
import { CategorySales } from "@/types/analytics";
import { formatCurrency } from "@/utils/helpers/format-currency";
import { useSearchParams } from "react-router-dom";
import { useWarehouses } from "@/context/WarehousesContext";

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

export default function SalesBySubCategoryChart({ height }: { height: string }) {
  const { language } = useLanguage();
  const { data: warehouses = [] } = useWarehouses();
  const [searchParams, setSearchParams] = useSearchParams();
  const warehouseId = searchParams.get("warehouseId") || "";
  
  const startDateParam = searchParams.get("startDate");
  const endDateParam = searchParams.get("endDate");
  const startDate = startDateParam !== null ? startDateParam : "";
  const endDate = endDateParam !== null ? endDateParam : "";

  const [data, setData] = useState<CategorySales[] | null>(null);
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
        url: "analytics/sales-by-sub-category",
        signal: controller.signal,
        language,
        params: {
          warehouseId: warehouseId || '',
          startDate: startDate || '',
          endDate: endDate || ''
        }
      });
      console.log('Sales by subcategory response:', response.data);
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

  if (loading) return (
    <div className="animate-pulse flex items-center justify-center" style={{ height }}>
      <div className="w-8 h-8 border-2 border-gray-300 rounded-full animate-spin"></div>
    </div>
  );

  if (error) return (
    <div className="flex items-center justify-center text-red-500" style={{ height }}>
      <div className="text-center">
        <p className="text-lg font-medium mb-2">{translate(language, "Error Loading Data", "خطأ في تحميل البيانات")}</p>
        <p className="text-sm">{error}</p>
        <button onClick={getData} className="mt-4 px-4 py-2 bg-red-100 text-red-700 rounded-md hover:bg-red-200">
          {translate(language, "Try Again", "حاول مرة أخرى")}
        </button>
      </div>
    </div>
  );

  if (!data?.length) {
    console.log('No data available:', data);
    return (
      <div className="flex items-center justify-center text-gray-500" style={{ height }}>
        <div className="text-center">
          <p className="text-lg font-medium">{translate(language, "No Data Available", "لا توجد بيانات متاحة")}</p>
          <p className="text-sm mt-2">{translate(language, "Try again later", "حاول مرة أخرى لاحقاً")}</p>
          <button onClick={getData} className="mt-4 px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200">
            {translate(language, "Refresh Data", "تحديث البيانات")}
          </button>
        </div>
      </div>
    );
  }

  // Prepare chart data
  const labels = data.flatMap((category) =>
    category.subcategories.map((sub) => translate(language, sub.name.en, sub.name.ar))
  );

  const chartData = {
    labels,
    datasets: [
      {
        label: translate(language, "Total Revenue (EGP)", "إجمالي الإيرادات (جنيه)"),
        data: data.flatMap((category) => 
          category.subcategories.map((sub) => sub.totalRevenue)
        ),
        backgroundColor: "#36A2EB",
        yAxisID: 'y-revenue',
      },
      {
        label: translate(language, "Average Order Value (EGP)", "متوسط قيمة الطلب (جنيه)"),
        data: data.flatMap((category) => 
          category.subcategories.map((sub) => sub.averageOrderValue)
        ),
        backgroundColor: "#4BC0C0",
        yAxisID: 'y-revenue',
      },
      {
        label: translate(language, "Total Quantity", "إجمالي الكمية"),
        data: data.flatMap((category) => 
          category.subcategories.map((sub) => sub.totalQuantitySold)
        ),
        backgroundColor: "#FF6384",
        yAxisID: 'y-quantity',
      },
     
    ],
  };

  const options: ChartOptions<"bar"> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: translate(language, "top", "bottom") as "top" | "bottom",
      },
      tooltip: {
        callbacks: {
          label: (context: TooltipItem<"bar">) => {
            const value = context.raw as number;
            const label = context.dataset.label || "";
            if (context.dataset.yAxisID === 'y-quantity') {
              return `${label}: ${value.toLocaleString()}`;
            }
            return `${label}: ${formatCurrency(value)}`;
          },
        },
      },
    },
    scales: {
      x: {
        ticks: {
          maxRotation: 45,
          minRotation: 45,
        },
      },
      'y-revenue': {
        type: 'linear',
        display: true,
        position: 'left',
        title: {
          display: false,
          text: translate(language, 'Revenue (EGP)', 'الإيرادات (جنيه)'),
        },
        ticks: {
          callback: (value) => formatCurrency(value as number),
        },
      },
      'y-quantity': {
        type: 'linear',
        display: true,
        position: 'right',
        title: {
          display:  false,
          text: translate(language, 'Quantity', 'الكمية'),
        },
        ticks: {
          callback: (value) => value.toLocaleString(),
        },
        grid: {
          drawOnChartArea: false,
        },
      },
    },
  };

  // Calculate summary data
  const summary = {
    totalRevenue: data.reduce((sum, category) => sum + category.totalRevenue, 0),
    totalOrders: data.reduce((sum, category) => sum + category.numberOfOrders, 0),
    averageOrderValue: data.reduce((sum, category) => sum + category.averageOrderValue, 0) / data.length
  };

  return (
    <Box height={height}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="mb-1">{translate(language, "Sales by Subcategory", "المبيعات حسب الفئة الفرعية")}</h3>
        </div>
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
      <div style={{ height: "calc(100% - 3rem)" }}>
        <Bar data={chartData} options={options} />
      </div>
      <div className="mt-4 grid grid-cols-3 gap-4">
        <div>
          <p className="text-sm font-medium">{translate(language, "Total Revenue", "إجمالي الإيرادات")}</p>
          <p className="text-lg font-bold">{formatCurrency(summary.totalRevenue)}</p>
        </div>
        <div>
          <p className="text-sm font-medium">{translate(language, "Total Orders", "إجمالي الطلبات")}</p>
          <p className="text-lg font-bold">{summary.totalOrders}</p>
        </div>
        <div>
          <p className="text-sm font-medium">{translate(language, "Average Order Value", "متوسط قيمة الطلب")}</p>
          <p className="text-lg font-bold">{formatCurrency(summary.averageOrderValue)}</p>
        </div>
      </div>
    </Box>
  );
}