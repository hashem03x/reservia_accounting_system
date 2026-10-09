import { DashboardMetric, MetricUnit } from "@/types/financial-dashboard";

const n2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n1 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

/** "1,234.50", negatives in parentheses (accounting convention). */
export const formatMoney = (value: number) => (value < 0 ? `(${n2.format(-value)})` : n2.format(value));
export const formatCompact = (value: number) => (value < 0 ? `-${compact.format(-value)}` : compact.format(value));

/** A metric value with its unit; `null` = not available. */
export function formatMetric(value: number | null, unit: MetricUnit, isArabic: boolean): { text: string; suffix: string } {
  if (value === null) return { text: isArabic ? "غير متاح" : "N/A", suffix: "" };
  switch (unit) {
    case "money":
      return { text: formatMoney(value), suffix: "" };
    case "percent":
      return { text: n2.format(value), suffix: "%" };
    case "times":
      return { text: n2.format(value), suffix: "×" };
    case "days":
      return { text: n1.format(value), suffix: isArabic ? " يوم" : " days" };
    default:
      return { text: n2.format(value), suffix: "" };
  }
}

export type Trend = { direction: "up" | "down" | "flat"; tone: "good" | "bad" | "neutral"; change: number; percent: number | null };

/**
 * Change against the comparison period - only when both values exist. Whether a rise is good
 * depends on the metric (`better`): more profit is good, more debt is not.
 */
export function trendOf(metric: DashboardMetric): Trend | null {
  if (metric.value === null || metric.previous === null) return null;
  const change = metric.value - metric.previous;
  const direction = Math.abs(change) < 0.005 ? "flat" : change > 0 ? "up" : "down";
  const percent = metric.previous !== 0 && metric.unit === "money" ? (change / Math.abs(metric.previous)) * 100 : null;
  const tone = direction === "flat" || !metric.better ? "neutral" : (direction === "up") === (metric.better === "higher") ? "good" : "bad";
  return { direction, tone, change, percent };
}

/** The change as text: % for amounts (when the previous value is not zero), else the difference in the metric's unit. */
export function formatChange(metric: DashboardMetric, trend: Trend, isArabic: boolean) {
  const sign = trend.change > 0 ? "+" : trend.change < 0 ? "−" : "";
  if (trend.percent !== null) return `${sign}${n1.format(Math.abs(trend.percent))}%`;
  if (metric.unit === "money") return `${sign}${formatCompact(Math.abs(trend.change))}`;
  const { text, suffix } = formatMetric(Math.abs(trend.change), metric.unit, isArabic);
  return `${sign}${text}${metric.unit === "percent" ? (isArabic ? " نقطة" : " pts") : suffix}`;
}

/** Period presets, as YYYY-MM-DD (UTC calendar days, the backend's reporting day). */
export type PresetKey = "thisMonth" | "lastMonth" | "thisQuarter" | "thisYear" | "previousYear" | "custom";
const iso = (d: Date) => d.toISOString().slice(0, 10);
export function presetRange(preset: Exclude<PresetKey, "custom">, today = new Date()): { from: string; to: string } {
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();
  switch (preset) {
    case "thisMonth":
      return { from: iso(new Date(Date.UTC(y, m, 1))), to: iso(today) };
    case "lastMonth":
      return { from: iso(new Date(Date.UTC(y, m - 1, 1))), to: iso(new Date(Date.UTC(y, m, 0))) };
    case "thisQuarter":
      return { from: iso(new Date(Date.UTC(y, Math.floor(m / 3) * 3, 1))), to: iso(today) };
    case "thisYear":
      return { from: `${y}-01-01`, to: iso(today) };
    case "previousYear":
      return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
  }
}

/** `date` moved back by `months` calendar months, the day clamped to that month's length. */
function monthsEarlier(value: string, months: number) {
  const [y, m, d] = value.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m - 1 - months + 1, 0)).getUTCDate();
  return iso(new Date(Date.UTC(y, m - 1 - months, Math.min(d, lastDay))));
}

/**
 * The comparison period for the to-date presets: the same span one month / quarter / year earlier
 * (e.g. 1-9 Oct against 1-9 Sep). Other periods use the backend's default (the preceding month /
 * quarter / year, or the preceding period of the same length).
 */
export function comparisonRange(preset: PresetKey, range: { from: string; to: string }): { compareFrom: string; compareTo: string } | null {
  const months = preset === "thisMonth" ? 1 : preset === "thisQuarter" ? 3 : preset === "thisYear" ? 12 : 0;
  return months ? { compareFrom: monthsEarlier(range.from, months), compareTo: monthsEarlier(range.to, months) } : null;
}
