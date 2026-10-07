// Shape of GET /dashboard/summary (docs section "Admin Home / Dashboard") - a single read-only
// aggregated endpoint, see backend/server/services/dashboard/dashboardService.js. Every figure is
// computed server-side; the frontend never re-derives any of these from a larger list of records.
export interface DashboardCashAccount {
  _id: string;
  code: string;
  name: string;
  nameAr?: string | null;
  balance: number;
}

export interface DashboardSalesTrendPoint {
  // "YYYY-MM"
  month: string;
  total: number;
}

export interface DashboardSummary {
  projects: {
    activeCount: number;
    totalContractValue: number;
    // Weighted: Σ(active projects' Sales Order amount before tax) / Σ(active projects' contract
    // value) × 100 - same formula as Project.executedPercentage, aggregated across active projects.
    executedPercentage: number;
  };
  sales: { total: number; count: number };
  purchases: { total: number; count: number };
  cash: { total: number; accounts: DashboardCashAccount[] };
  receivables: { total: number };
  payables: { total: number };
  salesTrend: DashboardSalesTrendPoint[];
}
