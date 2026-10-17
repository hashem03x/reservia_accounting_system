// Projected Cash Flow Forecasting - Phase 1 (backend: services/cashflow/cashFlowForecastService.js).
// Every figure here is read-only/derived - this feature never posts accounting.

export type CashFlowGranularity = "day" | "week" | "month";
export type CashFlowDirection = "in" | "out";
export type CashFlowObligationStatus =
  | "forecast"
  | "due_soon"
  | "overdue"
  | "partially_paid"
  | "unscheduled"
  | "draft"
  | "cannot_calculate";

export interface CashFlowParty {
  _id: string;
  name: string;
  vendorNumber?: number | null;
  customerNumber?: number | null;
}

export interface CashFlowProjectRef {
  _id: string;
  projectNumber: string;
  name?: string;
}

export interface CashFlowRequisitionRef {
  _id: string;
  code: string;
  status?: string;
  amount?: number;
  invoicedAmount?: number;
}

export interface CashFlowObligation {
  direction: CashFlowDirection;
  source: "salesOrder" | "project" | "purchaseInvoice" | "requisition";
  sourceId: string;
  code?: string | null;
  project?: CashFlowProjectRef | null;
  party?: CashFlowParty | null;
  requisition?: CashFlowRequisitionRef | null;
  amount: number;
  date: string | null;
  status: CashFlowObligationStatus;
  paymentStatus?: string;
  reason?: string;
}

export interface CashFlowTimelineBucket {
  period: string;
  from: string;
  to: string;
  opening: number;
  inflow: number;
  outflow: number;
  net: number;
  closing: number;
  shortfall: boolean;
}

export interface CashFlowTotals {
  expectedReceipts: number;
  expectedPayments: number;
  unscheduledReceipts: number;
  unscheduledPayments: number;
  netProjected: number;
  openingBalance: number;
  closingBalance: number;
  overdueReceipts: number;
  overduePayments: number;
}

export interface CashFlowShortfallProject {
  project: CashFlowProjectRef;
  net: number;
}

export interface CashFlowOpeningBalance {
  total: number;
  accounts: { _id: string; code: string; name: string; nameAr?: string; balance: number }[];
}

export interface CashFlowForecast {
  range: { from: string; to: string };
  granularity: CashFlowGranularity;
  opening: CashFlowOpeningBalance;
  timeline: CashFlowTimelineBucket[];
  totals: CashFlowTotals;
  shortfallProjects: CashFlowShortfallProject[];
  obligations: { inflows: CashFlowObligation[]; outflows: CashFlowObligation[] };
}

export interface ProjectCashFlowForecast extends CashFlowForecast {
  project: {
    _id: string;
    projectNumber: string;
    name?: string;
    contractValue?: number;
    customer?: CashFlowParty | null;
    status: string;
  } | null;
}
