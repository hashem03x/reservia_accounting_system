import { useLanguage } from "@/context/LanguageContext";
import translate from "@/utils/helpers/translate";
import { useEffect, useState } from "react";
import useFetchingStatus from "@/hooks/useFetchingStatus";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import handleRequest from "@/utils/helpers/handle-request";
import ErrorSection from "@/components/ui/sections/error";
import Loader from "./loader";
import Box from "./box";
import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  ChartOptions,
} from "chart.js";
import EmptySection from "@/components/ui/sections/empty";
import { formatCurrency } from "@/utils/helpers/format-currency";
import dayjs from "dayjs";
import { useWarehouses } from "@/context/WarehousesContext";
import { useSearchParams } from "react-router-dom";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

type TimeGrouping = "day" | "week" | "month" | "year";

type DailySalesType = {
  timePeriod: {
    start: string;
    end: string;
    groupBy: TimeGrouping;
  };
  salesByPeriod: {
    totalAmount: number;
    totalOrders: number;
    totalShipping: number;
    paidAmount: number;
    totalCOGS: number;
    date: string;
    pendingPayments: number;
    expenses: number;
    grossProfit: number;
    netProfit: number;
  }[];
  summary: {
    totalSales: number;
    totalCOGS: number;
    grossProfit: number;
    totalExpenses: number;
    netProfit: number;
    totalOrders: number;
    expenses: number;
    totalValue: number;
    totalFairValue: number;
  };
};

export default function DailySales({ height }: { height: string }) {
  const { language } = useLanguage();
  const { data: warehouses = [] } = useWarehouses();
  const [data, setData] = useState<DailySalesType | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  const startDateParam = searchParams.get("startDate");
  const endDateParam = searchParams.get("endDate");
  const warehouseId = searchParams.get("warehouseId") || "";

  const startDate = startDateParam || dayjs().subtract(1, "month").format("YYYY-MM-DDTHH:mm:ss");
  const endDate = endDateParam || dayjs().format("YYYY-MM-DDTHH:mm:ss");
  const [groupBy, setGroupBy] = useState<TimeGrouping>("day");

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
        url: `analytics/sales-by-time-period?startDate=${startDate}&endDate=${endDate}&groupBy=${groupBy}${warehouseId ? `&warehouseId=${warehouseId}` : ""}`,
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
  }, [searchParams, groupBy]);

  // Prepare chart data
  const chartData = {
    labels: data?.salesByPeriod?.map((sale) => dayjs(sale.date).format("MMM DD, YYYY")) || [],
    datasets: [
      {
        label: translate(language, "Order Amount", "مبلغ الطلب"),
        data: data?.salesByPeriod?.map((sale) => sale.totalAmount) || [],
        borderColor: "#36A2EB",
        backgroundColor: "#36A2EB",
        tension: 0.4,
      },
      {
        label: translate(language, "Cost", "التكلفة"),
        data: data?.salesByPeriod?.map((sale) => sale.totalCOGS) || [],
        borderColor: "#FFCE56",
        backgroundColor: "#FFCE56",
        tension: 0.4,
      },
      {
        label: translate(language, "Gross Profit", "الإيرادات النهائية"),
        data: data?.salesByPeriod?.map((sale) => sale.grossProfit) || [],
        borderColor: "#32CD32",
        backgroundColor: "#32CD32",
        tension: 0.4,
      },
    ],
  };

  const options: ChartOptions<"line"> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: translate(language, "top", "bottom") as "top" | "bottom",
      },
      tooltip: {
        mode: "index",
        intersect: false,
        callbacks: {
          label: function (context) {
            return `${context.dataset.label}: ${formatCurrency(context.parsed.y)}`;
          },
        },
      },
    },
    interaction: {
      mode: "nearest",
      axis: "x",
      intersect: false,
    },
    scales: {
      y: {
        beginAtZero: true,
        ticks: {
          callback: function (value) {
            return formatCurrency(value as number);
          },
        },
      },
    },
  };

  return (
    <Box height={height}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="mb-1">{translate(language, "Sales", "المبيعات")}</h3>
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
            <label className="text-sm">{translate(language, "Group By", "تجميع حسب")}:</label>
            <select
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value as TimeGrouping)}
              className="rounded-md border border-gray-300 px-2 py-1 text-sm"
            >
              <option value="day">{translate(language, "Day", "يوم")}</option>
              <option value="week">{translate(language, "Week", "أسبوع")}</option>
              <option value="month">{translate(language, "Month", "شهر")}</option>
              <option value="year">{translate(language, "Year", "سنة")}</option>
              <option value="quarter">{translate(language, "Quarter", "أربعة")}</option>
            </select>
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
          errorTitle={translate(language, "Error Generating Report", "خطأ في تحميل التقرير")}
          errorMessage={error}
          button={{ text: translate(language, "Try Again", "حاول مرة أخرى"), onClick: getData }}
        />
      ) : (
        data && (
          <>
            <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-5">
              <div className="rounded-lg bg-blue-50 p-3">
                <p className="text-sm font-medium text-blue-600">{translate(language, "Total Sales", "إجمالي المبيعات")}</p>
                <p className="text-lg font-bold text-blue-800">{formatCurrency(data?.summary?.totalSales || 0)}</p>
              </div>
    
              <div className="rounded-lg bg-purple-50 p-3">
                <p className="text-sm font-medium text-purple-600">{translate(language, "COGS", "إجمالي المصاريف")}</p>
                <p className="text-lg font-bold text-purple-800">{formatCurrency(data?.summary?.totalCOGS || 0)}</p>
              </div>
              <div className="rounded-lg bg-green-50 p-3">
                <p className="text-sm font-medium text-green-600">{translate(language, "Gross Profit", "صافي الربح")}</p>
                <p className="text-lg font-bold text-green-800">{formatCurrency(data?.summary?.grossProfit || 0)}</p>
              </div>
              <div className="rounded-lg bg-yellow-50 p-3">
                <p className="text-sm font-medium text-yellow-600">
                  {translate(language, "Gross Margin", "هامش الربح الإجمالي")}
                </p>
                <p className="text-lg font-bold text-yellow-800">
                  {data?.summary?.totalSales ? ((data.summary.grossProfit / data.summary.totalSales) * 100).toFixed(2) : "0"}
                  %
                </p>
              </div>
              <div className="rounded-lg bg-orange-50 p-3">
                <p className="text-sm font-medium text-orange-600">
                  {translate(language, "Net Margin", "هامش الربح الصافي")}
                </p>
                <p className="text-lg font-bold text-orange-800">
                  {data?.summary?.totalSales ? ((data.summary.netProfit / data.summary.totalSales) * 100).toFixed(2) : "0"}%
                </p>
              </div>
              <div className="rounded-lg bg-red-50 p-3">
                <p className="text-sm font-medium text-red-600">
                  {translate(language, "Total Expenses", "إجمالي المصاريف")}
                </p>
                <p className="text-lg font-bold text-red-800">{formatCurrency(data?.summary?.totalExpenses || 0)}</p>
              </div>
              <div className="rounded-lg bg-teal-50 p-3">
                <p className="text-sm font-medium text-teal-600">{translate(language, "Net Profit", "صافي الربح")}</p>
                <p className="text-lg font-bold text-teal-800">{formatCurrency(data?.summary?.netProfit || 0)}</p>
              </div>
              <div className="rounded-lg bg-pink-50 p-3">
                  <p className="text-sm font-medium text-pink-600">{translate(language, "Total Orders", "إجمالي الطلبات")}</p>
                  <p className="text-lg font-bold text-pink-800">{data?.summary?.totalOrders || 0}</p>
                </div>
              <div className="rounded-lg bg-blue-50 p-3">
                <p className="text-sm font-medium text-blue-600">
                  {translate(language, "Total Inventory Value", "إجمالي قيمة المخزن")}
                </p>
                <p className="text-lg font-bold text-blue-800">{formatCurrency(data?.summary?.totalValue || 0)}</p>
              </div>
              <div className="rounded-lg bg-orange-50 p-3">
                <p className="text-sm font-medium text-orange-600">
                  {translate(language, "Total Fair Value", "إجمالي القيمة الصحيحة")}
                </p>
                <p className="text-lg font-bold text-orange-800">{formatCurrency(data?.summary?.totalFairValue || 0)}</p>
              </div>
            </div>
            {!data?.salesByPeriod?.length ? (
              <EmptySection
                message={translate(language, "No data available", "لا تتوفر بيانات")}
                className="flex-1 border-0"
              />
            ) : (
              <div className="flex-1 animate-fade-in">
                <Line data={chartData} options={options} />
              </div>
            )}
          </>
        )
      )}
    </Box>
  );
}
