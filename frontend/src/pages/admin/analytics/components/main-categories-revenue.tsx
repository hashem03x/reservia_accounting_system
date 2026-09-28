import { useLanguage } from "@/context/LanguageContext";
import translate from "@/utils/helpers/translate";
import { useEffect, useState } from "react";
import useFetchingStatus from "@/hooks/useFetchingStatus";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import handleRequest from "@/utils/helpers/handle-request";
import ErrorSection from "@/components/ui/sections/error";
import Loader from "./loader";
import Box from "./box";
import { Doughnut } from "react-chartjs-2";
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from "chart.js";
import { TooltipItem } from "chart.js";
import EmptySection from "@/components/ui/sections/empty";
import { CategorySales } from "@/types/analytics";
import { useSearchParams } from "react-router-dom";
import { useWarehouses } from "@/context/WarehousesContext";

ChartJS.register(ArcElement, Tooltip, Legend);

type MainCategoriesRevenueType = CategorySales[];

export default function MainCategoriesRevenue({ height }: { height: string }) {
  const { language } = useLanguage();
  const { data: warehouses = [] } = useWarehouses();
  const [searchParams, setSearchParams] = useSearchParams();
  const warehouseId = searchParams.get("warehouseId") || "";

  const [data, setData] = useState<MainCategoriesRevenueType | null>(null);

  const { loading, setLoading, error, setError } = useFetchingStatus();
  const privateRequest = usePrivateRequest();

  function getData() {
    const controller = new AbortController();
    const canceled = { current: false };

    const executeFetch = async () => {
      const response = await privateRequest({
        url: "analytics/sales-by-sub-category",
        signal: controller.signal,
        language,
        params: {
          warehouseId: warehouseId || ''
        }
      });
      setData(response.data || null);
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
  }, [warehouseId]);

  // Prepare chart data
  const chartData = {
    labels: data?.map((category) => translate(language, category.categoryName.en, category.categoryName.ar)),
    datasets: [
      {
        data: data?.map((category) => category.totalRevenue),
        backgroundColor: [
          '#36A2EB',  // Blue
          '#FF6384',  // Pink
          '#4BC0C0',  // Teal
          '#FF9F40',  // Orange
          '#9966FF',  // Purple
          '#FFCD56',  // Yellow
        ],
        borderWidth: 1,
        borderColor: '#fff',
      },
    ],
  };

  const options = {
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: true,
        position: translate(language, "right", "left") as "right" | "left",
        labels: {
          font: {
            size: 14,
          },
          generateLabels: (chart: any) => {
            const data = chart.data;
            if (data.labels.length && data.datasets.length) {
              return data.labels.map((label: string, i: number) => {
                const value = data.datasets[0].data[i];
                const total = data.datasets[0].data.reduce((acc: number, val: number) => acc + val, 0);
                const percentage = ((value / total) * 100).toFixed(1);
                return {
                  text: `${label} (${percentage}%)`,
                  fillStyle: data.datasets[0].backgroundColor[i],
                  strokeStyle: data.datasets[0].backgroundColor[i],
                  lineWidth: 0,
                  hidden: false,
                  index: i,
                };
              });
            }
            return [];
          },
        },
      },
      tooltip: {
        displayColors: false,
        padding: 10,
        callbacks: {
          label: (tooltipItem: TooltipItem<"doughnut">) => {
            const dataset = tooltipItem.dataset;
            const total = dataset.data.reduce((acc: number, val: number) => acc + val, 0);
            const currentValue = dataset.data[tooltipItem.dataIndex];
            const percentage = ((currentValue / total) * 100).toFixed(1);
            return [
              `${translate(language, "Revenue", "الإيرادات")}: ${currentValue.toLocaleString()} ${translate(language, "EGP", "ج.م")}`,
              `${translate(language, "Percentage", "النسبة")}: ${percentage}%`
            ];
          },
        },
      },
    },
  };

  const updateFilter = (key: string, value: string | null) => {
    const newSearchParams = new URLSearchParams(searchParams);
    if (value) {
      newSearchParams.set(key, value);
    } else {
      newSearchParams.delete(key);
    }
    setSearchParams(newSearchParams);
  };

  return (
    <Box height={height}>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold">
          {translate(language, "Main Categories Revenue", "إيرادات الفئات الرئيسية")}
        </h2>
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
      <div style={{ height: "calc(100% - 3rem)" }}>
        {loading ? (
          <Loader />
        ) : error ? (
          <ErrorSection
            errorTitle={translate(language, "Error Generating Report", "خطأ في تحميل التقرير")}
            errorMessage={error}
            button={{ text: translate(language, "Try Again", "حاول مرة أخرى"), onClick: getData }}
          />
        ) : (
          data &&
          (data.length === 0 ? (
            <EmptySection message={translate(language, "No data available", "لا تتوفر بيانات")} className="flex-1 border-0" />
          ) : (
            <Doughnut data={chartData} options={options} />
          ))
        )}
      </div>
    </Box>
  );
}
