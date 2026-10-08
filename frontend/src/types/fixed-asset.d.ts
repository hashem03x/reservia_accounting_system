import { ChartOfAccountRef } from "./orders";

export type FixedAssetStatus = "active" | "fully_depreciated" | "disposed" | "under_maintenance";
// Derived from the asset account's Chart of Accounts group: Property, Plant & Equipment
// (depreciated) or Intangible Assets (amortized).
export type FixedAssetClass = "tangible" | "intangible";

export type JournalEntryRef = { _id: string; entryNumber: number };

// One processed depreciation/amortization month ('YYYY-MM').
export interface FixedAssetDepreciation {
  period: string;
  amount: number;
  date: string;
  journalEntry: string | JournalEntryRef;
  createdAt?: string;
}

export interface FixedAsset {
  _id: string;
  name: string;
  vendor?: { _id: string; name: string; vendorNumber?: number | null } | null;
  // Acquisition cost (excluding VAT).
  price?: number;
  bookValue: number;
  accumulatedDepreciation?: number;
  usefulLifeMonths?: number;
  monthlyDepreciation?: number;
  vatPercentage?: number;
  vatAmount?: number;
  totalAmount?: number;
  assetAccountId?: ChartOfAccountRef | null;
  accumulatedAccountId?: ChartOfAccountRef | null;
  depreciationAccountId?: ChartOfAccountRef | null;
  assetClass?: FixedAssetClass | null;
  acquisitionDate?: string;
  acquisitionJournalEntry?: string | JournalEntryRef | null;
  depreciations?: FixedAssetDepreciation[];
  status?: FixedAssetStatus;
  // Only on assets created before the Fixed Assets module.
  warehouseId?: { _id: string; name: string } | null;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export type FixedAssetAccountOption = ChartOfAccountRef & { type?: string; assetClass?: FixedAssetClass };

// GET fixed-assets/account-options - resolved from the Chart of Accounts groups on the server.
export interface FixedAssetAccountOptions {
  assetAccounts: FixedAssetAccountOption[];
  accumulatedDepreciationAccounts: FixedAssetAccountOption[];
  accumulatedAmortizationAccounts: FixedAssetAccountOption[];
  depreciationExpenseAccounts: FixedAssetAccountOption[];
}

export interface DepreciationRunResult {
  period: string;
  date: string;
  totalAmount: number;
  processed: {
    asset: string;
    name: string;
    amount: number;
    bookValue: number;
    accumulatedDepreciation: number;
    journalEntry: string;
    entryNumber: number;
  }[];
}
