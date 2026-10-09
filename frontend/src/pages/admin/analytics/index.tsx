import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, SegmentedControl } from "@mantine/core";
import { DateInput } from "@mantine/dates";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { toDateOnly } from "@/utils/helpers/format-date";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import ErrorSection from "@/components/ui/sections/error";
import { outlineIcons, solidIcons } from "@/components/icons";
import { DashboardGroupKey, FinancialDashboard } from "@/types/financial-dashboard";
import { KpiPanel, MetricRow, MetricRowSkeleton } from "./_components/kpi-panel";
import { CashFlowChart, PerformanceChart, ProfitabilityChart } from "./_components/analytics-charts";
import { comparisonRange, PresetKey, presetRange } from "./_components/format";

const GROUP_ICONS: Record<DashboardGroupKey, React.ReactNode> = {
  profitability: <outlineIcons.ChartBar />,
  liquidity: <outlineIcons.DollarSign />,
  solvency: <outlineIcons.ShieldCheck />,
  debt: <outlineIcons.Building />,
  efficiency: <outlineIcons.Clock />,
  advanced: <outlineIcons.Analytics />,
};
// Rows each panel shows while loading, so the layout does not jump.
const SKELETON_ROWS: Record<DashboardGroupKey, number> = { profitability: 6, liquidity: 4, solvency: 5, debt: 3, efficiency: 5, advanced: 3 };
const GROUP_TITLES: Record<DashboardGroupKey, [string, string]> = {
  profitability: ["Profitability", "الربحية"],
  liquidity: ["Liquidity", "السيولة"],
  solvency: ["Solvency", "الملاءة المالية"],
  debt: ["Debt Management", "إدارة الديون"],
  efficiency: ["Operational Efficiency", "الكفاءة التشغيلية"],
  advanced: ["Advanced Financial Metrics", "مؤشرات مالية متقدمة"],
};

const toDate = (value: string) => new Date(`${value}T00:00:00`);

export default function Analytics() {
  const { language, translate } = useLanguage();
  const isArabic = language === "ar-EG";
  useDocumentTitle(`${translate("Analytics", "التحليلات")} | ${translate("Admin Panel", "لوحة التحكم")}`);

  // ---------------- reporting period
  const [preset, setPreset] = useState<PresetKey>("thisYear");
  const [range, setRange] = useState(() => presetRange("thisYear"));
  const [customFrom, setCustomFrom] = useState<Date | null>(toDate(range.from));
  const [customTo, setCustomTo] = useState<Date | null>(toDate(range.to));

  function choosePreset(value: string) {
    const key = value as PresetKey;
    setPreset(key);
    if (key !== "custom") setRange(presetRange(key));
    else {
      setCustomFrom(toDate(range.from));
      setCustomTo(toDate(range.to));
    }
  }
  const customInvalid = preset === "custom" && (!customFrom || !customTo || customFrom > customTo);

  // ---------------- data (stale responses are aborted / ignored)
  const { privateRequest, loading, setLoading, error, setError, data, setData } = useDataHandler<FinancialDashboard | null>({ initialData: null, initialLoading: true });
  const requestId = useRef(0);
  const params = useMemo(() => ({ ...range, ...(comparisonRange(preset, range) || {}) }), [range, preset]);

  function load() {
    const id = ++requestId.current;
    const controller = new AbortController();
    const canceled = { current: false };
    handleRequest(
      language,
      setLoading,
      setError,
      async () => {
        const res = await privateRequest({ url: "analytics/financial-dashboard", params, signal: controller.signal, language });
        if (id === requestId.current) setData(res.data);
      },
      canceled,
    );
    return () => {
      controller.abort();
      canceled.current = true;
    };
  }
  useEffect(() => load(), [params]);

  const groups = useMemo(() => new Map((data?.groups || []).map((g) => [g.key, g])), [data]);
  const comparisonLabel = data ? `${translate("Previous period", "الفترة السابقة")} (${data.comparison.from} → ${data.comparison.to})` : "";

  const panel = (key: DashboardGroupKey) => {
    const group = groups.get(key);
    return (
      <KpiPanel key={key} title={translate(...GROUP_TITLES[key])} icon={GROUP_ICONS[key]}>
        {!group ? Array.from({ length: SKELETON_ROWS[key] }, (_, i) => <MetricRowSkeleton key={i} />) : group.metrics.map((m) => <MetricRow key={m.key} metric={m} comparisonLabel={comparisonLabel} />)}
      </KpiPanel>
    );
  };

  const presets: { value: PresetKey; label: string }[] = [
    { value: "thisMonth", label: translate("This month", "هذا الشهر") },
    { value: "lastMonth", label: translate("Last month", "الشهر الماضي") },
    { value: "thisQuarter", label: translate("This quarter", "هذا الربع") },
    { value: "thisYear", label: translate("This year", "هذا العام") },
    { value: "previousYear", label: translate("Previous year", "العام السابق") },
    { value: "custom", label: translate("Custom", "مخصص") },
  ];

  return (
    <AdminLayoutBox
      header={{
        title: translate("Analytics", "التحليلات"),
        subTitle: translate("Financial performance and operational insights", "الأداء المالي والمؤشرات التشغيلية"),
        sideElements: (
          <Button variant="light" onClick={() => load()} loading={loading} leftSection={!loading && <outlineIcons.ArrowUpCircle />}>
            {translate("Refresh", "تحديث")}
          </Button>
        ),
      }}
    >
      <div className="flex flex-col gap-4">
        {/* Reporting period */}
        <div className="flex flex-col gap-3 rounded-lg border border-gray-100 bg-white p-3 dark:border-gray-700 dark:bg-gray-800 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
              <solidIcons.Calendar size={11} /> {translate("Reporting period", "فترة التقرير")}
            </span>
            <div className="max-w-full overflow-x-auto">
              <SegmentedControl size="xs" value={preset} onChange={choosePreset} data={presets} />
            </div>
          </div>
          {preset === "custom" ? (
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!customInvalid && customFrom && customTo) setRange({ from: toDateOnly(customFrom), to: toDateOnly(customTo) });
              }}
            >
              <DateInput size="xs" label={translate("From", "من")} value={customFrom} onChange={setCustomFrom} valueFormat="YYYY-MM-DD" w={130} />
              <DateInput size="xs" label={translate("To", "إلى")} value={customTo} onChange={setCustomTo} valueFormat="YYYY-MM-DD" w={130} error={customInvalid && customFrom && customTo ? translate("Before start", "قبل البداية") : undefined} />
              <Button type="submit" size="xs" disabled={customInvalid}>
                {translate("Apply", "تطبيق")}
              </Button>
            </form>
          ) : (
            <p className="text-xs text-gray-500 tabular-nums dark:text-gray-400">
              {range.from} → {range.to}
              {data && (
                <span className="ms-2">
                  · {translate("compared with", "مقارنة بـ")} {data.comparison.from} → {data.comparison.to}
                </span>
              )}
            </p>
          )}
        </div>

        {error && !data ? (
          <ErrorSection errorTitle={translate("Error loading analytics", "خطأ في تحميل التحليلات")} errorMessage={error} button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: load }} />
        ) : (
          <>
            {error && <Alert color="red" variant="light">{error}</Alert>}
            {data && !data.hasActivity && (
              <Alert color="gray" variant="light">
                {translate("No posted transactions in this period - choose another period.", "لا توجد قيود مرحلة في هذه الفترة - اختر فترة أخرى.")}
              </Alert>
            )}

            <div className={`grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 ${loading && data ? "opacity-70 transition-opacity" : ""}`} aria-busy={loading}>
              <div className="flex min-w-0 flex-col gap-4">
                {panel("profitability")}
                {panel("efficiency")}
                {panel("advanced")}
              </div>
              <div className="flex min-w-0 flex-col gap-4">
                {panel("liquidity")}
                {panel("solvency")}
                <CashFlowChart data={data} loading={loading} />
              </div>
              <div className="flex min-w-0 flex-col gap-4 md:col-span-2 xl:col-span-1">
                {panel("debt")}
                <PerformanceChart data={data} loading={loading} />
                <ProfitabilityChart data={data} loading={loading} />
              </div>
            </div>

            {data && data.notes.length > 0 && (
              <div className="flex flex-col gap-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                {data.notes.map((n, i) => (
                  <p key={i}>{isArabic ? n.ar : n.en}</p>
                ))}
                <p>{translate("Hover or focus a metric name to see its formula.", "مرر المؤشر أو انتقل إلى اسم المقياس لرؤية طريقة حسابه.")}</p>
              </div>
            )}
          </>
        )}
      </div>
    </AdminLayoutBox>
  );
}
