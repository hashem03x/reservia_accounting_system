// GET accounting-periods - a month with no record is open.
export type AccountingPeriodStatus = "open" | "closed";

export interface AccountingPeriodEvent {
  action: "closed" | "reopened";
  by?: { _id: string; name: string } | null;
  at: string;
  note?: string;
}

export interface AccountingPeriod {
  _id?: string;
  period: string; // 'YYYY-MM'
  status: AccountingPeriodStatus;
  closedAt?: string | null;
  reopenedAt?: string | null;
  history: AccountingPeriodEvent[];
}

export interface ExpenseCategory {
  _id: string;
  name: string;
  nameAr?: string | null;
  description?: string;
  isActive: boolean;
  expenseCount?: number;
}
