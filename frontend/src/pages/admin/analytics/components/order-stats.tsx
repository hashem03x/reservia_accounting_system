import { useLanguage } from "@/context/LanguageContext";
import translate from "@/utils/helpers/translate";
import { useEffect, useState } from "react";
import useFetchingStatus from "@/hooks/useFetchingStatus";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import handleRequest from "@/utils/helpers/handle-request";
import Box from "./box";
import { Doughnut } from "react-chartjs-2";
import { Chart as ChartJS, ArcElement, Tooltip, Legend, ChartOptions } from "chart.js";
import { formatCurrency } from "@/utils/helpers/format-currency";
import dayjs from "dayjs";
import { useWarehouses } from "@/context/WarehousesContext";
import { useSearchParams } from "react-router-dom";

ChartJS.register(ArcElement, Tooltip, Legend);

type OrderStats = {
  _id: null;
  totalOrders: number;
  maxOrderValue: number;
  minOrderValue: number;
  averageOrderValue: number;
  totalRevenue: number;
  totalShippingCost: number;
  totalPaidAmount: number;
  pendingPayments: number;
  netRevenue: number;
};

type OrderByStatus = {
  count: number;
  totalAmount: number;
  status: string;
};

type OrderBySource = {
  count: number;
  totalAmount: number;
  source: string;
};

type ReturnStats = {
  _id: null;
  totalReturns: number;
  totalReturnAmount: number;
};

type DateRange = {
  start: string;
  end: string;
};

type OrderStatsResponse = {
  orderStats: OrderStats;
  ordersByDeliveryStatus: OrderByStatus[];
  ordersByPaymentStatus: OrderByStatus[];
  ordersBySource: OrderBySource[];
  returnStats: ReturnStats;
  dateRange: DateRange;
};

export default function OrderStats({ height }: { height: string }) {
  const { language } = useLanguage();
  const { data: warehouses = [] } = useWarehouses();
  const [searchParams, setSearchParams] = useSearchParams();
  const warehouseId = searchParams.get("warehouseId") || "";

  const [data, setData] = useState<OrderStatsResponse | null>(null);
  const [startDate, setStartDate] = useState(dayjs().subtract(1, "year").format("YYYY-MM-DDTHH:mm:ss"));
  const [endDate, setEndDate] = useState(dayjs().format("YYYY-MM-DDTHH:mm:ss"));
  const { setError, setLoading, error, loading } = useFetchingStatus();
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

  const fetchData = async () => {
    const controller = new AbortController();
    const canceled = { current: false };

    const executeFetch = async () => {
      const response = await privateRequest({
        url: `analytics/order-statistics?startDate=${startDate}&endDate=${endDate}${warehouseId ? `&warehouseId=${warehouseId}` : ""}`,
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
  };

  useEffect(() => {
    fetchData();
  }, [startDate, endDate, warehouseId]);

  if (loading)
    return (
      <div className="flex animate-pulse items-center justify-center" style={{ height }}>
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-300"></div>
      </div>
    );

  if (error)
    return (
      <div className="flex items-center justify-center text-red-500" style={{ height }}>
        <div className="text-center">
          <p className="mb-2 text-lg font-medium">{translate(language, "Error Loading Data", "خطأ في تحميل البيانات")}</p>
          <p className="text-sm">{error}</p>
          <button onClick={fetchData} className="mt-4 rounded-md bg-red-100 px-4 py-2 text-red-700 hover:bg-red-200">
            {translate(language, "Try Again", "حاول مرة أخرى")}
          </button>
        </div>
      </div>
    );

  if (!data)
    return (
      <div className="flex items-center justify-center text-gray-500" style={{ height }}>
        <div className="text-center">
          <p className="text-lg font-medium">{translate(language, "No Data Available", "لا توجد بيانات متاحة")}</p>
          <p className="mt-2 text-sm">{translate(language, "Try again later", "حاول مرة أخرى لاحقاً")}</p>
          <button onClick={fetchData} className="mt-4 rounded-md bg-gray-100 px-4 py-2 text-gray-700 hover:bg-gray-200">
            {translate(language, "Refresh Data", "تحديث البيانات")}
          </button>
        </div>
      </div>
    );

  const paymentStatusOptions: ChartOptions<"doughnut"> = {
    responsive: true,
    maintainAspectRatio: true,
    plugins: {
      legend: {
        position: "bottom",
        display: true,
      },
    },
  };

  const paymentStatusData = {
    labels: data.ordersByPaymentStatus.map((status) =>
      translate(language, status.status, status.status === "Fully Paid" ? "مدفوع بالكامل" : "غير مدفوع"),
    ),
    datasets: [
      {
        data: data.ordersByPaymentStatus.map((status) => status.totalAmount),
        backgroundColor: ["#10B981", "#EF4444"],
        borderWidth: 0,
      },
    ],
  };

  const sourceData = {
    labels: data.ordersBySource.map((source) =>
      translate(language, source.source, source.source === "Cashier" ? "الكاشير" : source.source),
    ),
    datasets: [
      {
        data: data.ordersBySource.map((source) => source.totalAmount),
        backgroundColor: ["#6366F1", "#EF4444"],
        borderWidth: 0,
      },
    ],
  };

  return (
    <Box height={height}>
      <div className="mb-4 flex flex-col items-start justify-between sm:flex-row sm:items-center">
        <h2 className="mb-4 text-lg font-semibold sm:mb-0">{translate(language, "Order Statistics", "إحصائيات الطلبات")}</h2>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <div className="flex gap-2">
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full rounded border px-2 py-1 sm:w-auto"
            />
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full rounded border px-2 py-1 sm:w-auto"
            />
          </div>
          <select
            value={warehouseId}
            onChange={(e) => updateFilter("warehouseId", e.target.value)}
            className="w-full rounded border px-2 py-1 sm:w-auto"
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
        {/* <h3 className="mb-1">{translate(language, "Order Statistics", "إحصائيات الطلبات")}</h3> */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded bg-gray-50 p-4">
            <h3 className="mb-2 font-semibold">{translate(language, "Orders Overview", "نظرة عامة على الطلبات")}</h3>
            <div className="space-y-2">
              <p>
                {translate(language, "Total Orders", "إجمالي الطلبات")}: {data.orderStats.totalOrders}
              </p>
              <p>
                {translate(language, "Max Order Value", "أعلى قيمة للطلب")}: {formatCurrency(data.orderStats.maxOrderValue)}
              </p>
              <p>
                {translate(language, "Min Order Value", "أدنى قيمة للطلب")}: {formatCurrency(data.orderStats.minOrderValue)}
              </p>
              <p>
                {translate(language, "Average Order Value", "متوسط قيمة الطلب")}:{" "}
                {formatCurrency(data.orderStats.averageOrderValue)}
              </p>
            </div>
          </div>

          <div className="rounded bg-gray-50 p-4">
            <h3 className="mb-2 font-semibold">{translate(language, "Revenue", "الإيرادات")}</h3>
            <div className="space-y-2">
              <p>
                {translate(language, "Total Revenue", "إجمالي الإيرادات")}: {formatCurrency(data.orderStats.totalRevenue)}
              </p>
              <p>
                {translate(language, "Total Shipping Cost", "إجمالي تكلفة الشحن")}:{" "}
                {formatCurrency(data.orderStats.totalShippingCost)}
              </p>
              {/* <p>{translate(language, "Net Revenue", "صافي الإيرادات")}: {formatCurrency(data.orderStats.netRevenue)}</p> */}
            </div>
          </div>

          <div className="rounded bg-gray-50 p-4">
            <h3 className="mb-2 font-semibold">{translate(language, "Payments", "المدفوعات")}</h3>
            <div className="space-y-2">
              <p>
                {translate(language, "Total Paid", "إجمالي المدفوعات")}: {formatCurrency(data.orderStats.totalPaidAmount)}
              </p>
              <p>
                {translate(language, "Pending Payments", "المدفوعات المعلقة")}:{" "}
                {formatCurrency(data.orderStats.pendingPayments)}
              </p>
            </div>
          </div>

          <div className="rounded bg-gray-50 p-4">
            <h3 className="mb-2 font-semibold">{translate(language, "Returns", "المرتجعات")}</h3>
            <div className="space-y-2">
              <p>
                {translate(language, "Total Returns", "إجمالي المرتجعات")}: {data.returnStats.totalReturns}
              </p>
              <p>
                {translate(language, "Total Return Amount", "إجمالي قيمة المرتجعات")}:{" "}
                {formatCurrency(data.returnStats.totalReturnAmount)}
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
          <div className="flex flex-col items-center rounded bg-gray-50 p-4">
            <h3 className="mb-4 text-center font-semibold">{translate(language, "Payment Status", "حالة الدفع")}</h3>
            <div className="aspect-square w-full max-w-[250px]">
              <Doughnut data={paymentStatusData} options={paymentStatusOptions} />
            </div>
          </div>

          <div className="flex flex-col items-center rounded bg-gray-50 p-4">
            <h3 className="mb-4 text-center font-semibold">{translate(language, "Order Sources", "مصادر الطلبات")}</h3>
            <div className="aspect-square w-full max-w-[250px]">
              <Doughnut data={sourceData} options={paymentStatusOptions} />
            </div>
          </div>
        </div>
      </div>
    </Box>
  );
}
