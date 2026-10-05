import { ChartOfAccount } from "./chart-of-account";

export type JournalEntryStatus = "draft" | "posted" | "reversed";
export type JournalEntrySource = "manual" | "project_creation" | "fixed_asset_purchase";
// The originating business module (docs section "Module field") - normalized through
// AccountingModules/AccountingModuleByAction on the backend, never a free-text variation. `null`
// only for an entry that predates this field.
export type AccountingModule = "Advanced Payment" | "Purchase Order" | "Sales Order" | "Payment" | "Manual" | "Fixed Asset" | "Project";

export interface JournalLine {
  account: ChartOfAccount;
  subAccount?: ChartOfAccount | null;
  // The resolved Customer/Vendor Number for THIS specific line (docs section "Sub Account
  // behavior") - set only on the one control-account line of an automatic entry that actually
  // represents a business party. `null` on every other line and on manual entries.
  partyNumber?: number | null;
  partyType?: "customer" | "vendor" | null;
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
  module?: AccountingModule | null;
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

// One row of the General Ledger line view (GET journal-entries/general-ledger - docs section
// "Journal Entries / General Ledger table") - one row per JournalEntry LINE (not per entry), each
// carrying a running balance for its own account. Nullable fields reflect genuinely optional/
// historical data (never fabricated - see generalLedgerService.js#getGeneralLedgerLines).
export interface GeneralLedgerRow {
  entryId: string;
  lineIndex: number;
  documentDate: string;
  documentNumber: number;
  accNumber: string | null;
  accName: string | null;
  accountId: string | null;
  // Resolved from the entry's source document (Sales/Purchase Order, Payment, Advanced Payment,
  // Project) - a real Customer/Vendor Number, never a name or _id. `null` when the entry has no
  // resolvable party (e.g. a manual entry) or the party has no number assigned.
  subAccount: { type: "customer" | "vendor"; number: number } | null;
  projectNumber: string | null;
  currency: string | null;
  rate: number;
  debit: number;
  credit: number;
  balanceDocumentCurrency: number;
  balanceLocalCurrency: number;
  description: string | null;
  module: AccountingModule | null;
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
