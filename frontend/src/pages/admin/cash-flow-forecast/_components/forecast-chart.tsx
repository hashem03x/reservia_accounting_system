import { Chart } from "react-chartjs-2";
import { Chart as ChartJS, BarElement, CategoryScale, Filler, Legend, LinearScale, LineElement, PointElement, Tooltip, BarController, LineController, type ChartData, type ChartOptions } from "chart.js";
import { useLanguage } from "@/context/LanguageContext";
import { CashFlowTimelineBucket } from "@/types/cashflow";
import { ChartPanel, useChartBase } from "@/pages/admin/analytics/_components/analytics-charts";

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, BarController, LineController, Filler, Tooltip, Legend);

export default function ForecastChart({ timeline, loading }: { timeline: CashFlowTimelineBucket[]; loading: boolean }) {
  const { translate, language } = useLanguage();
  const { colors, options } = useChartBase();
  const isArEG = language === "ar-EG";
  const empty = timeline.every((p) => !p.inflow && !p.outflow);

  const locale = isArEG ? "ar-EG" : "en-US";
  const fmt = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" });
  const labels = timeline.map((p) => fmt.format(new Date(`${p.from.slice(0, 10)}T00:00:00Z`)));

  return (
    <ChartPanel
      title={translate("Projected Cash Flow Timeline", "الجدول الزمني للتدفق النقدي المتوقع")}
      subtitle={translate(
        "Scheduled inflows/outflows only - unscheduled amounts are shown in the summary totals, not here.",
        "التدفقات المجدولة فقط - المبالغ غير المجدولة تظهر في الإجماليات، لا هنا.",
      )}
      loading={loading}
      empty={empty}
      emptyText={translate("No scheduled inflows or outflows in this period.", "لا توجد تدفقات مجدولة في هذه الفترة.")}
    >
      <Chart<"bar" | "line", number[], string>
        type="bar"
        options={options(true) as ChartOptions<"bar" | "line">}
        data={
          {
            labels,
            datasets: [
              { type: "bar", label: translate("Inflow", "التدفق الداخل"), data: timeline.map((p) => p.inflow), backgroundColor: colors.green, borderRadius: 3, maxBarThickness: 24, order: 2 },
              { type: "bar", label: translate("Outflow", "التدفق الخارج"), data: timeline.map((p) => -p.outflow), backgroundColor: colors.amber, borderRadius: 3, maxBarThickness: 24, order: 2 },
              { type: "line", label: translate("Closing balance", "الرصيد الختامي"), data: timeline.map((p) => p.closing), borderColor: colors.navy, backgroundColor: colors.navy, pointRadius: 2, borderWidth: 2, tension: 0.25, order: 1 },
            ],
          } as ChartData<"bar" | "line", number[], string>
        }
      />
    </ChartPanel>
  );
}
