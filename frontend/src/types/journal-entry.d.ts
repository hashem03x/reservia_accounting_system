import { ChartOfAccount } from "./chart-of-account";

export type JournalEntryStatus = "draft" | "posted" | "reversed";
export type JournalEntrySource = "manual" | "project_creation" | "fixed_asset_purchase";
// The originating business module (docs section "Module field") - normalized through
// AccountingModules/AccountingModuleByAction on the backend, never a free-text variation. `null`
// only for an entry that predates this field.
export type AccountingModule = "Advanced Payment" | "Purchase Order" | "Sales Order" | "Payment" | "Manual" | "Fixed Asset" | "Project" | "Expense" | "Equity";

export interface JournalLine {
  // Nullable: populate resolves a reference to a since-removed account to null - never assume it.
  account: ChartOfAccount | null;
  subAccount?: ChartOfAccount | null;
  // The resolved Customer/Vendor Number for THIS specific line (docs section "Sub Account
  // behavior") - set only on the one control-account line of an automatic entry that actually
  // represents a business party. `null` on every other line and on manual entries.
  partyNumber?: number | null;
  partyType?: "customer" | "vendor" | "shareholder" | null;
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
  // Historical data field - kept on the type for compatibility, no longer displayed anywhere.
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
  // Set only on PROJECT_REVENUE_RECOGNITION/PROJECT_COST_RECOGNITION entries, whose real
  // sourceId/sourceType can't point back at a Sales Order (it's a project+percentage hash) - the
  // one reliable link for those two entries back to the Sales Order that triggered them (docs
  // section "Sales Order Source Link"). `null` for every other entry, including historical
  // recognition entries created before this field existed.
  triggeredBySalesOrder?: { _id: string; code: string } | null;
  // The Advanced Payment this entry belongs to (its creation entry or an entry that consumed it).
  // `null` for every other entry and for entries created before this link existed.
  advancedPayment?: string | null;
  status: JournalEntryStatus;
  lines: JournalLine[];
  totalDebit: number;
  totalCredit: number;
  // Derived server-side (docs section "Which balance should the main page show?") - only present
  // on rows returned by the plain `GET journal-entries` listing (handled by the `withEntryListFields`
  // transform in journalEntryController.js), never computed in React. `currency`/`rate` reflect the
  // first line that actually carries them (most entries are single-currency, local-currency-only,
  // so both are commonly null). `difference` is Total Debit - Total Credit for the WHOLE entry (0
  // for a valid/balanced entry) - NEVER a per-account running balance, which is a different concept
  // only shown on the General Ledger view (GeneralLedgerRow below).
  currency?: string | null;
  rate?: number | null;
  difference?: number;
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
