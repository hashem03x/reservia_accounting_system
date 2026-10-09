import { ReactNode } from "react";
import { Skeleton, useComputedColorScheme } from "@mantine/core";
import { Bar, Chart, Line } from "react-chartjs-2";
import { Chart as ChartJS, BarElement, CategoryScale, Filler, Legend, LinearScale, LineElement, PointElement, Tooltip, BarController, LineController, type ChartData, type ChartOptions } from "chart.js";
import { useLanguage } from "@/context/LanguageContext";
import { FinancialDashboard } from "@/types/financial-dashboard";
import { formatCompact, formatMoney } from "./format";

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, BarController, LineController, Filler, Tooltip, Legend);

// Brand-aligned palette (tailwind primary navy + accessible companions), with lighter variants
// for dark mode so every series keeps its contrast on the dark surface.
const PALETTE = {
  light: { navy: "#123B5D", blue: "#5D85A8", slate: "#AEB9C2", green: "#15803D", amber: "#B45309", grid: "rgba(23,33,43,0.06)", tick: "#66727F" },
  dark: { navy: "#82A3BF", blue: "#5D85A8", slate: "#66727F", green: "#4ADE80", amber: "#FBBF24", grid: "rgba(255,255,255,0.08)", tick: "#8D9BA6" },
};

export function ChartPanel({ title, subtitle, loading, empty, emptyText, children }: { title: string; subtitle?: string; loading: boolean; empty: boolean; emptyText: string; children: ReactNode }) {
  return (
    <section className="flex flex-col overflow-hidden rounded-lg border border-gray-100 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <header className="border-b border-gray-100 px-4 py-2.5 dark:border-gray-700">
        <h3 className="text-sm font-semibold text-white dark:text-gray-100">{title}</h3>
        {subtitle && <p className="text-xs text-gray-500 dark:text-gray-400">{subtitle}</p>}
      </header>
      <div className="relative h-64 p-3 sm:h-72">
        {loading ? <Skeleton height="100%" radius="md" /> : empty ? <div className="flex h-full items-center justify-center text-center text-sm text-gray-500 dark:text-gray-400">{emptyText}</div> : children}
      </div>
    </section>
  );
}

function useChartBase() {
  const { language } = useLanguage();
  const isArabic = language === "ar-EG";
  const scheme = useComputedColorScheme("light");
  const colors = PALETTE[scheme === "dark" ? "dark" : "light"];
  const options = (stacked = false): ChartOptions<"bar" | "line"> => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { position: "bottom", rtl: isArabic, labels: { color: colors.tick, boxWidth: 10, boxHeight: 10, usePointStyle: true, font: { size: 11 } } },
      tooltip: { rtl: isArabic, callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${formatMoney(Number(ctx.parsed.y))}` } },
    },
    scales: {
      x: { stacked, grid: { display: false }, ticks: { color: colors.tick, font: { size: 11 }, maxRotation: 0, autoSkipPadding: 12 }, reverse: isArabic },
      y: { stacked, grid: { color: colors.grid }, border: { display: false }, ticks: { color: colors.tick, font: { size: 11 }, callback: (v) => formatCompact(Number(v)) }, position: isArabic ? "right" : "left" },
    },
  });
  return { isArabic, colors, options };
}

function labelsOf(data: FinancialDashboard, isArabic: boolean) {
  const locale = isArabic ? "ar-EG" : "en-US";
  const fmt = data.series.granularity === "month" ? new Intl.DateTimeFormat(locale, { month: "short", year: "2-digit", timeZone: "UTC" }) : new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" });
  return data.series.points.map((p) => fmt.format(new Date(`${p.key.length === 7 ? `${p.key}-01` : p.key}T00:00:00Z`)));
}

const isEmpty = (data: FinancialDashboard | null, keys: (keyof FinancialDashboard["series"]["points"][number])[]) => !data || data.series.points.every((p) => keys.every((k) => !p[k]));

/** Revenue and total costs per month/day, with the net profit line. */
export function PerformanceChart({ data, loading }: { data: FinancialDashboard | null; loading: boolean }) {
  const { translate } = useLanguage();
  const { isArabic, colors, options } = useChartBase();
  const empty = isEmpty(data, ["revenue", "cogs", "expenses"]);
  return (
    <ChartPanel
      title={translate("Revenue vs Expenses", "الإيرادات مقابل المصروفات")}
      subtitle={translate("Costs = cost of sales + expenses · line: net profit", "التكاليف = تكلفة المبيعات + المصروفات · الخط: صافي الربح")}
      loading={loading && !data}
      empty={empty}
      emptyText={translate("No revenue or expenses in this period.", "لا توجد إيرادات أو مصروفات في هذه الفترة.")}
    >
      {data && (
        <Chart<"bar" | "line", number[], string>
          type="bar"
          options={options() as ChartOptions<"bar" | "line">}
          data={
            {
              labels: labelsOf(data, isArabic),
              datasets: [
                { type: "bar", label: translate("Revenue", "الإيرادات"), data: data.series.points.map((p) => p.revenue), backgroundColor: colors.navy, borderRadius: 3, maxBarThickness: 28, order: 2 },
                { type: "bar", label: translate("Costs", "التكاليف"), data: data.series.points.map((p) => p.cogs + p.expenses), backgroundColor: colors.slate, borderRadius: 3, maxBarThickness: 28, order: 3 },
                // The net profit line drawn over the bars (mixed chart).
                { type: "line", label: translate("Net profit", "صافي الربح"), data: data.series.points.map((p) => p.netProfit), borderColor: colors.green, backgroundColor: colors.green, pointRadius: 2, borderWidth: 2, tension: 0.25, order: 1 },
              ],
            } as ChartData<"bar" | "line", number[], string>
          }
        />
      )}
    </ChartPanel>
  );
}

/** Gross and net profit trend. */
export function ProfitabilityChart({ data, loading }: { data: FinancialDashboard | null; loading: boolean }) {
  const { translate } = useLanguage();
  const { isArabic, colors, options } = useChartBase();
  const empty = isEmpty(data, ["grossProfit", "netProfit"]);
  return (
    <ChartPanel title={translate("Profitability Trend", "اتجاه الربحية")} loading={loading && !data} empty={empty} emptyText={translate("No profit or loss in this period.", "لا يوجد ربح أو خسارة في هذه الفترة.")}>
      {data && (
        <Line
          options={options() as ChartOptions<"line">}
          data={{
            labels: labelsOf(data, isArabic),
            datasets: [
              { label: translate("Gross profit", "مجمل الربح"), data: data.series.points.map((p) => p.grossProfit), borderColor: colors.navy, backgroundColor: `${colors.navy}1F`, fill: true, pointRadius: 2, borderWidth: 2, tension: 0.25 },
              { label: translate("Net profit", "صافي الربح"), data: data.series.points.map((p) => p.netProfit), borderColor: colors.green, backgroundColor: colors.green, pointRadius: 2, borderWidth: 2, tension: 0.25 },
            ],
          }}
        />
      )}
    </ChartPanel>
  );
}

/** Operating / investing / financing cash flow per month/day (stacked). */
export function CashFlowChart({ data, loading }: { data: FinancialDashboard | null; loading: boolean }) {
  const { translate } = useLanguage();
  const { isArabic, colors, options } = useChartBase();
  const empty = isEmpty(data, ["operating", "investing", "financing"]);
  return (
    <ChartPanel
      title={translate("Cash Flow", "التدفقات النقدية")}
      subtitle={translate("Actual cash movements; transfers between cash accounts excluded", "حركة النقدية الفعلية؛ التحويلات بين حسابات النقدية مستبعدة")}
      loading={loading && !data}
      empty={empty}
      emptyText={translate("No cash movements in this period.", "لا توجد حركة نقدية في هذه الفترة.")}
    >
      {data && (
        <Bar
          options={options(true) as ChartOptions<"bar">}
          data={{
            labels: labelsOf(data, isArabic),
            datasets: [
              { label: translate("Operating", "تشغيلية"), data: data.series.points.map((p) => p.operating), backgroundColor: colors.navy, maxBarThickness: 28 },
              { label: translate("Investing", "استثمارية"), data: data.series.points.map((p) => p.investing), backgroundColor: colors.blue, maxBarThickness: 28 },
              { label: translate("Financing", "تمويلية"), data: data.series.points.map((p) => p.financing), backgroundColor: colors.amber, maxBarThickness: 28 },
            ],
          }}
        />
      )}
    </ChartPanel>
  );
}
