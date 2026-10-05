import { useComputedColorScheme } from "@mantine/core";
import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  type ChartOptions,
} from "chart.js";
import dayjs from "dayjs";
import { DashboardSummary } from "@/types/dashboard";
import { useLanguage } from "@/context/LanguageContext";
import { formatCurrency } from "@/utils/helpers/format-currency";
import SectionCard from "@/components/ui/section-card";
import EmptySection from "@/components/ui/sections/empty";
import ErrorSection from "@/components/ui/sections/error";
import { Skeleton } from "@mantine/core";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip);

// Sales Performance trend (docs section "Sales / Revenue Trend") - uses the pre-computed, already
// pre-tax `salesTrend` from GET /dashboard/summary (6 trailing months, server-aggregated) - never
// a second client-side recomputation, and never every historical Sales Order loaded into the
// browser just to draw this chart.
export default function SalesTrendChart({
  summary,
  loading,
  error,
  onRetry,
}: {
  summary: DashboardSummary | null;
  loading: boolean;
  error: string;
  onRetry: () => void;
}) {
  const { language, translate } = useLanguage();
  const colorScheme = useComputedColorScheme("light");
  const isDark = colorScheme === "dark";

  const gridColor = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)";
  const tickColor = isDark ? "#8D9BA6" : "#66727F";

  const trend = summary?.salesTrend || [];
  const hasData = trend.some((p) => p.total > 0);

  const chartData = {
    labels: trend.map((p) => dayjs(`${p.month}-01`).format("MMM YYYY")),
    datasets: [
      {
        label: translate("Sales (excl. tax)", "المبيعات (بدون ضريبة)"),
        data: trend.map((p) => p.total),
        borderColor: "#123B5D",
        backgroundColor: "rgba(18, 59, 93, 0.08)",
        fill: true,
        tension: 0.3,
        pointRadius: 3,
        pointBackgroundColor: "#123B5D",
      },
    ],
  };

  const options: ChartOptions<"line"> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (context) => formatCurrency(context.parsed.y, language),
        },
      },
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: tickColor } },
      y: {
        beginAtZero: true,
        grid: { color: gridColor },
        ticks: { color: tickColor, callback: (value) => formatCurrency(value as number, language) },
      },
    },
  };

  return (
    <SectionCard title={translate("Sales Performance", "أداء المبيعات")}>
      {error ? (
        <ErrorSection
          errorTitle={translate("Error loading sales trend", "خطأ في تحميل اتجاه المبيعات")}
          errorMessage={error}
          button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: onRetry }}
        />
      ) : loading ? (
        <Skeleton height={240} />
      ) : !hasData ? (
        <EmptySection
          useDefaultImg
          message={translate("No sales activity in the last 6 months", "لا يوجد نشاط مبيعات خلال آخر 6 أشهر")}
        />
      ) : (
        <div style={{ height: 240 }}>
          <Line data={chartData} options={options} />
        </div>
      )}
    </SectionCard>
  );
}
