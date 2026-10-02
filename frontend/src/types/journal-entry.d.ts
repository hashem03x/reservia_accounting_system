import { ChartOfAccount } from "./chart-of-account";

export type JournalEntryStatus = "draft" | "posted" | "reversed";
export type JournalEntrySource = "manual" | "project_creation" | "fixed_asset_purchase";

export interface JournalLine {
  account: ChartOfAccount;
  subAccount?: ChartOfAccount | null;
  project?: { _id: string; projectNumber: string } | null;
  projectNumber?: string | null;
  debit: number;
  credit: number;
  // Audit-trail only - debit/credit above always hold the local-currency amount. These preserve
  // the original foreign-currency amount/rate when a line was imported from a multi-currency
  // source (e.g. the accounting CSV import).
  currency?: string | null;
  exchangeRate?: number | null;
  description?: string;
  unearnedRevenue?: number;
}

export interface JournalEntry {
  _id: string;
  entryNumber: number;
  date: string;
  description?: string;
  source: JournalEntrySource;
  sourceType?: string | null;
  sourceId?: string | null;
  reference?: string;
  project?: { _id: string; projectNumber: string; name?: string } | null;
  status: JournalEntryStatus;
  lines: JournalLine[];
  totalDebit: number;
  totalCredit: number;
  createdBy?: { _id: string; name: string };
  postedBy?: { _id: string; name: string } | null;
  postedAt?: string | null;
  reversedBy?: string | null;
  reversedAt?: string | null;
  reversalOfEntry?: string | null;
  reversedByEntry?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface JournalLineInput {
  account: string;
  subAccount?: string | null;
  project?: string | null;
  projectNumber?: string | null;
  debit: number | string;
  credit: number | string;
  description?: string;
  unearnedRevenue?: number | string;
}
