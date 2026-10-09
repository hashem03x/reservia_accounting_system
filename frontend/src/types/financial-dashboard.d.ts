// GET /analytics/financial-dashboard (backend: services/analytics/financialDashboardService.js).

export type LocalizedText = { en: string; ar: string };

export type MetricUnit = "money" | "percent" | "ratio" | "times" | "days";

export type DashboardMetric = {
  key: string;
  label: LocalizedText;
  unit: MetricUnit;
  // Which direction is an improvement; null when neither is (e.g. paying suppliers later).
  better: "higher" | "lower" | null;
  formula: LocalizedText;
  value: number | null;
  // Why the value is unavailable (value === null).
  reason: LocalizedText | null;
  // The same metric for the comparison period (null when not available there).
  previous: number | null;
};

export type DashboardGroupKey = "profitability" | "liquidity" | "solvency" | "debt" | "efficiency" | "advanced";

export type DashboardSeriesPoint = {
  key: string; // YYYY-MM or YYYY-MM-DD
  revenue: number;
  cogs: number;
  expenses: number;
  grossProfit: number;
  netProfit: number;
  operating: number;
  investing: number;
  financing: number;
};

export type FinancialDashboard = {
  period: { from: string; to: string };
  comparison: { from: string; to: string };
  generatedAt: string;
  currency: string;
  hasActivity: boolean;
  groups: { key: DashboardGroupKey; title: LocalizedText; metrics: DashboardMetric[] }[];
  totals: Record<string, number>;
  series: { granularity: "day" | "month"; points: DashboardSeriesPoint[] };
  notes: LocalizedText[];
};
