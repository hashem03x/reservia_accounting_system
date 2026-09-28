import { Bar } from "react-chartjs-2";
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend, ChartOptions, TooltipItem } from "chart.js";
import { useLanguage } from "@/context/LanguageContext";
import translate from "@/utils/helpers/translate";
import { useEffect, useState, useCallback } from "react";
import useFetchingStatus from "@/hooks/useFetchingStatus";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import handleRequest from "@/utils/helpers/handle-request";
import Box from "./box";
import { CustomerInsights } from "@/types/analytics";
import { formatCurrency } from "@/utils/helpers/format-currency";
import { formatDate } from "@/utils/helpers/format-date";
import { useSearchParams } from "react-router-dom";
import { useWarehouses } from "@/context/WarehousesContext";

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

export default function CustomerInsightsChart({ height }: { height: string }) {
  const { language } = useLanguage();
  const { data: warehouses = [] } = useWarehouses();
  const [searchParams, setSearchParams] = useSearchParams();
  const warehouseId = searchParams.get("warehouseId") || "";

  const startDateParam = searchParams.get("startDate");
  const endDateParam = searchParams.get("endDate");
  const startDate = startDateParam !== null ? startDateParam : "";
  const endDate = endDateParam !== null ? endDateParam : "";

  const [data, setData] = useState<CustomerInsights | null>(null);
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
        url: "analytics/customer-insights",
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

  if (!data) return (
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

  // Prepare chart data for top customers
  const chartData = {
    labels: data.topCustomers.map(customer => customer.name),
    datasets: [
      {
        label: translate(language, "Total Spent", "إجمالي الإنفاق"),
        data: data.topCustomers.map(customer => customer.totalSpent),
        backgroundColor: "#36A2EB",
        borderRadius: 6,
      },
      {
        label: translate(language, "Average Order Value", "متوسط قيمة الطلب"),
        data: data.topCustomers.map(customer => customer.averageOrderValue),
        backgroundColor: "#4BC0C0",
        borderRadius: 6,
      }
    ],
  };

  const options: ChartOptions<"bar"> = {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: 'y' as const,
    plugins: {
      legend: {
        position: 'top' as const,
      },
      tooltip: {
        callbacks: {
          label: (context: TooltipItem<"bar">) => {
            const value = context.raw as number;
            const label = context.dataset.label || "";
            return `${label}: ${formatCurrency(value)}`;
          },
        },
      },
    },
    scales: {
      x: {
        beginAtZero: true,
        ticks: {
          callback: function(tickValue: number | string) {
            const value = Number(tickValue);
            return formatCurrency(value);
          },
        },
      },
      y: {
        ticks: {
          font: {
            size: 12,
          },
        },
      },
    },
  };

  return (
    <Box height={height}>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold">
          {translate(language, "Customer Insights", "تحليل العملاء")}
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
        {/* <h3 className="mb-1">{translate(language, "Customer Insights", "تحليل العملاء")}</h3> */}
        {/* Customer Overview */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-blue-50 p-4 rounded-lg">
            <p className="text-sm font-medium text-blue-600">{translate(language, "Total Customers", "إجمالي العملاء")}</p>
            <p className="text-2xl font-bold text-blue-800">{data.totalCustomers}</p>
          </div>
          <div className="bg-green-50 p-4 rounded-lg">
            <p className="text-sm font-medium text-green-600">{translate(language, "Online Customers", "العملاء عبر الإنترنت")}</p>
            <p className="text-2xl font-bold text-green-800">{data.onlineCustomers}</p>
          </div>
          <div className="bg-purple-50 p-4 rounded-lg">
            <p className="text-sm font-medium text-purple-600">{translate(language, "Offline Customers", "العملاء المباشرين")}</p>
            <p className="text-2xl font-bold text-purple-800">{data.offlineCustomers}</p>
          </div>
          <div className="bg-yellow-50 p-4 rounded-lg">
            <p className="text-sm font-medium text-yellow-600">{translate(language, "New Customers", "العملاء الجدد")}</p>
            <p className="text-2xl font-bold text-yellow-800">{data.newCustomers}</p>
          </div>
          {/* active customers */}
          <div className="bg-green-50 p-4 rounded-lg">
            <p className="text-sm font-medium text-green-600">{translate(language, "Active Customers", "العملاء النشطين")}</p>
            <p className="text-2xl font-bold text-green-800">{data.activeCustomers}</p>
          </div>
        </div>

        {/* Customer Categories */}
        <div className="mb-6">
          <h4 className="text-sm font-medium mb-2">{translate(language, "Customer Categories", "فئات العملاء")}</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-gray-50 p-3 rounded-lg">
              <p className="text-xs text-gray-600">{translate(language, "VIP", "كبار الشخصيات")}</p>
              <p className="text-lg font-bold">{data.customerMetrics.customerCategories.vip}</p>
            </div>
            <div className="bg-gray-50 p-3 rounded-lg">
              <p className="text-xs text-gray-600">{translate(language, "Premium", "مميز")}</p>
              <p className="text-lg font-bold">{data.customerMetrics.customerCategories.premium}</p>
            </div>
            <div className="bg-gray-50 p-3 rounded-lg">
              <p className="text-xs text-gray-600">{translate(language, "Regular", "عادي")}</p>
              <p className="text-lg font-bold">{data.customerMetrics.customerCategories.regular}</p>
            </div>
            <div className="bg-gray-50 p-3 rounded-lg">
              <p className="text-xs text-gray-600">{translate(language, "New", "جديد")}</p>
              <p className="text-lg font-bold">{data.customerMetrics.customerCategories.new}</p>
            </div>
          </div>
        </div>

        {/* Order Sources */}
        {data.customerMetrics.orderSources && (
          <div className="mb-6">
            <h4 className="text-sm font-medium mb-2">{translate(language, "Order Sources", "مصادر الطلبات")}</h4>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-gray-50 p-3 rounded-lg">
                <p className="text-xs text-gray-600">{translate(language, "Website", "الموقع الإلكتروني")}</p>
                <p className="text-lg font-bold">{data.customerMetrics.orderSources.website}</p>
              </div>
              <div className="bg-gray-50 p-3 rounded-lg">
                <p className="text-xs text-gray-600">{translate(language, "Cashier", "الكاشير")}</p>
                <p className="text-lg font-bold">{data.customerMetrics.orderSources.cashier}</p>
              </div>
            </div>
          </div>
        )}

        {/* Customer Metrics */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div>
            <p className="text-sm font-medium">{translate(language, "Average Order Value", "متوسط قيمة الطلب")}</p>
            <p className="text-lg font-bold">{formatCurrency(data.customerMetrics.averageOrderValue)}</p>
          </div>
          <div>
            <p className="text-sm font-medium">{translate(language, "Orders per Customer", "الطلبات لكل عميل")}</p>
            <p className="text-lg font-bold">{data.customerMetrics.averageOrdersPerCustomer.toFixed(1)}</p>
          </div>
          <div>
            <p className="text-sm font-medium">{translate(language, "Total Revenue", "إجمالي الإيرادات")}</p>
            <p className="text-lg font-bold">{formatCurrency(data.customerMetrics.totalRevenue)}</p>
          </div>
        </div>

        {/* Top Customers Details */}
        <div className="mb-6">
          <h4 className="text-sm font-medium mb-2">{translate(language, "Top Customers Details", "تفاصيل كبار العملاء")}</h4>
          <div className="space-y-4">
            {data.topCustomers.map((customer) => (
              <div key={customer._id} className="bg-gray-50 p-4 rounded-lg">
                <div className="flex justify-between items-start">
                  <div>
                    <h5 className="font-medium">{customer.name}</h5>
                    <p className="text-sm text-gray-600">{customer.phone}</p>
                    {customer.email && <p className="text-sm text-gray-600">{customer.email}</p>}
                  </div>
                  <div className="text-right">
                    <span className={`inline-block px-2 py-1 text-xs rounded ${
                      customer.type === 'online' ? 'bg-green-100 text-green-800' : 'bg-purple-100 text-purple-800'
                    }`}>
                      {translate(language, customer.type === 'online' ? 'Online' : 'Offline', customer.type === 'online' ? 'عبر الإنترنت' : 'مباشر')}
                    </span>
                    <span className={`ml-2 inline-block px-2 py-1 text-xs rounded ${
                      customer.customerStatus === 'VIP' ? 'bg-yellow-100 text-yellow-800' :
                      customer.customerStatus === 'Premium' ? 'bg-purple-100 text-purple-800' :
                      customer.customerStatus === 'Regular' ? 'bg-blue-100 text-blue-800' :
                      'bg-green-100 text-green-800'
                    }`}>
                      {translate(language, customer.customerStatus, 
                        customer.customerStatus === 'VIP' ? 'كبار الشخصيات' :
                        customer.customerStatus === 'Premium' ? 'مميز' :
                        customer.customerStatus === 'Regular' ? 'عادي' : 'جديد'
                      )}
                    </span>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <p className="text-gray-600">{translate(language, "Total Orders", "إجمالي الطلبات")}</p>
                    <p className="font-medium">{customer.totalOrders}</p>
                  </div>
                  <div>
                    <p className="text-gray-600">{translate(language, "Total Spent", "إجمالي الإنفاق")}</p>
                    <p className="font-medium">{formatCurrency(customer.totalSpent)}</p>
                  </div>
                  <div>
                    <p className="text-gray-600">{translate(language, "Average Order", "متوسط الطلب")}</p>
                    <p className="font-medium">{formatCurrency(customer.averageOrderValue)}</p>
                  </div>
                </div>
                <div className="mt-2 text-sm text-gray-600">
                  <p>{translate(language, "Last Order", "آخر طلب")}: {formatDate(customer.lastOrderDate, language)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Top Customers Chart */}
        <div>
          <h4 className="text-sm font-medium mb-2">{translate(language, "Top Customers by Spending", "كبار العملاء حسب الإنفاق")}</h4>
          <div className="h-[400px] w-full">
            <Bar data={chartData} options={{
              ...options,
              maintainAspectRatio: false,
              responsive: true,
            }} />
          </div>
        </div>
      </div>
    </Box>
  );
}
