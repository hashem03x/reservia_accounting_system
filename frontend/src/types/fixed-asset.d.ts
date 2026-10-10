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
  // FA-0001, ... - null for an asset created before numbering (until backfilled).
  assetNumber?: number | null;
  assetCode?: string | null;
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

// GET fixed-assets/:id/payments - the summary is read from the ledger on the server: payable = the
// acquisition entry's credit to the vendor; only payments whose entry is still posted count.
export type FixedAssetPaymentStatus = "unpaid" | "partially_paid" | "paid" | "not_applicable";
export type FixedAssetPaymentRowStatus = "posted" | "reversed" | "missing_entry";

export interface FixedAssetPaymentRow {
  _id: string;
  payment: string;
  date: string;
  amount: number;
  currency: string;
  paymentAccount?: ChartOfAccountRef | null;
  vendor?: { _id: string; name: string; vendorNumber?: number | null } | null;
  reference?: string | null;
  notes?: string | null;
  status: FixedAssetPaymentRowStatus;
  journalEntry: JournalEntryRef | string;
  reversalEntry?: (JournalEntryRef & { date: string }) | null;
  createdBy?: { _id: string; name: string } | null;
  createdAt?: string;
}

export interface FixedAssetPayments {
  asset: {
    _id: string;
    name: string;
    assetClass?: FixedAssetClass | null;
    acquisitionDate?: string;
    vendor?: { _id: string; name: string; vendorNumber?: number | null } | null;
    acquisitionJournalEntry?: string | null;
  };
  summary: {
    acquisitionCost: number | null;
    vatAmount: number;
    payable: number | null;
    totalPaid: number;
    outstanding: number | null;
    status: FixedAssetPaymentStatus;
    review: string | null;
    currency: string;
  };
  payments: FixedAssetPaymentRow[];
}

// GET vendors/:id/fixed-asset-acquisitions - the vendor page's fixed asset acquisitions.
export interface VendorFixedAssetAcquisition {
  _id: string;
  assetNumber: string | null;
  name: string;
  assetClass?: FixedAssetClass | null;
  acquisitionDate?: string;
  projectNumber: string | null;
  cost: number | null;
  vatAmount: number;
  acquisitionAmount: number | null;
  currency: string;
  totalPaid: number;
  outstanding: number | null;
  status: FixedAssetPaymentStatus;
  review: string | null;
  acquisitionJournalEntry: (JournalEntryRef & { status: string }) | null;
  payments: {
    date: string;
    amount: number;
    reference: string | null;
    status: FixedAssetPaymentRowStatus;
    journalEntry: JournalEntryRef | null;
  }[];
}
