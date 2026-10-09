import { ReactNode } from "react";
import { Skeleton, Tooltip } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import { solidIcons } from "@/components/icons";
import { DashboardMetric } from "@/types/financial-dashboard";
import { formatChange, formatMetric, trendOf } from "./format";

/** A titled KPI panel: navy header, dense metric rows. `children` is used while loading. */
export function KpiPanel({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-lg border border-gray-100 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <header className="flex items-center gap-2 bg-primary-600 px-4 py-2.5 text-white dark:bg-primary-800">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-white/10 text-[15px]" aria-hidden>
          {icon}
        </span>
        <h3 className="truncate text-sm font-semibold tracking-wide text-white">{title}</h3>
      </header>
      <div className="divide-y divide-gray-100 dark:divide-gray-700">{children}</div>
    </section>
  );
}

export function MetricRowSkeleton() {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <Skeleton height={12} width="45%" />
      <Skeleton height={16} width="30%" />
    </div>
  );
}

const toneClass = {
  good: "text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-900/30",
  bad: "text-red-700 bg-red-50 dark:text-red-300 dark:bg-red-900/30",
  neutral: "text-gray-600 bg-gray-100 dark:text-gray-300 dark:bg-gray-700",
};

/**
 * One metric: label (with its formula on hover / focus), value with unit, and - only when the
 * comparison period has a value - the change, coloured by whether it is an improvement.
 */
export function MetricRow({ metric, comparisonLabel }: { metric: DashboardMetric; comparisonLabel: string }) {
  const { language, translate } = useLanguage();
  const isArabic = language === "ar-EG";
  const t = (text: { en: string; ar: string }) => (isArabic ? text.ar : text.en);
  const value = formatMetric(metric.value, metric.unit, isArabic);
  const previous = formatMetric(metric.previous, metric.unit, isArabic);
  const trend = trendOf(metric);
  const negative = metric.value !== null && metric.value < 0 && (metric.unit === "money" || metric.unit === "percent");

  return (
    <div className="px-4 py-2.5 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/40">
      <div className="flex items-center justify-between gap-3">
        <Tooltip label={t(metric.formula)} multiline w={280} withArrow events={{ hover: true, focus: true, touch: true }}>
          <span tabIndex={0} className="min-w-0 cursor-help truncate text-sm text-gray-600 underline decoration-dotted decoration-gray-300 underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-primary-400 dark:text-gray-300 dark:decoration-gray-600">
            {t(metric.label)}
          </span>
        </Tooltip>
        <div className="flex shrink-0 items-center gap-2">
          <span className={`whitespace-nowrap text-base font-semibold tabular-nums ${metric.value === null ? "text-gray-400 dark:text-gray-500" : negative ? "text-red-600 dark:text-red-400" : "text-gray-800 dark:text-gray-100"}`}>
            {value.text}
            {value.suffix && <span className="ms-0.5 text-xs font-medium text-gray-500 dark:text-gray-400">{value.suffix}</span>}
          </span>
          {trend && (
            <Tooltip label={`${comparisonLabel}: ${previous.text}${previous.suffix}`} withArrow events={{ hover: true, focus: true, touch: true }}>
              <span tabIndex={0} className={`inline-flex items-center gap-0.5 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-semibold tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-primary-400 ${toneClass[trend.tone]}`}>
                {trend.direction === "up" ? <solidIcons.ArrowUp size={9} /> : trend.direction === "down" ? <solidIcons.ArrowDown size={9} /> : null}
                {trend.direction === "flat" ? translate("No change", "بدون تغيير") : formatChange(metric, trend, isArabic)}
              </span>
            </Tooltip>
          )}
        </div>
      </div>
      {metric.value === null && metric.reason && <p className="mt-1 text-xs leading-snug text-gray-500 dark:text-gray-400">{t(metric.reason)}</p>}
    </div>
  );
}
