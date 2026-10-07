import type { AccountState } from "@/utils/constants/accounting";

// 'cogs' is a distinct type (not folded into 'expense') - carried over directly from the CSV
// source's own "Costs" vs "Expenses" distinction, see backend's accountingConstants.js. This is
// what lets Project Average Cost eligibility be determined structurally from `type === 'cogs'`.
export type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense" | "cogs";

export interface ChartOfAccount {
  _id: string;
  code: string;
  name: string;
  // Arabic name, when the account was imported from a bilingual source (e.g. the accounting CSV
  // import) - optional since manually created accounts only ever have the single `name` field.
  nameAr?: string | null;
  type: AccountType;
  // Secondary classification on top of `type` (e.g. Current/Non-Current, Direct/Indirect) - see
  // utils/constants/accounting.ts#AccountStates. Never auto-assigned to imported accounts.
  state?: AccountState | null;
  parentAccount?: { _id: string; code: string; name: string; type: AccountType } | null;
  // Descriptive group label copied verbatim from a bilingual source's "Parent" column (e.g. the
  // accounting CSV import) - NOT a reference to another account, just text. Only set when the
  // account has no real `parentAccount` link.
  parentGroupNameEn?: string | null;
  parentGroupNameAr?: string | null;
<<<<<<< HEAD
  // Legacy insertion-order field - always server-computed, never user-editable. NOT used for
  // display ordering: the Chart of Accounts is always listed by account number (`code`),
  // numerically (see utils/helpers/account-sort.ts).
=======
  // Display/insertion order within the account's type group - always server-computed, never
  // user-editable. Sort ascending on this (not `code`) everywhere accounts are listed so new
  // accounts consistently land at the bottom of their group.
>>>>>>> 368811657e0eba1f2e8b46ee732d01745194d628
  sortOrder?: number;
  description?: string;
  isActive: boolean;
  isSystemDefault: boolean;
  // Only present on the single-account GET response (chartOfAccountController.js#getAccount) - how
  // many Projects currently reference this account in their Average Cost lines.
  usedInProjectsCount?: number;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AccountBalance {
  account: { _id: string; code: string; name: string; type: AccountType };
  debit: number;
  credit: number;
  balance: number;
}
