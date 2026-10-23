import { BankInfo, BusinessDocument, PaymentInfo, TaxInfo } from "@/types/document";
import type { VendorPaymentAccount } from "@/utils/helpers/vendor-payment-accounts";

export type VendorType = "current" | "equity";

// Payment Terms (docs section "Payment Terms for Customers and Vendors").
export type PaymentTerms = "Immediate" | "Net 15" | "Net 30" | "Net 45" | "Net 60" | "Custom";

export type Vendor = {
  _id: string;
  // The vendor's own number - issued from 2000 upwards (2000, 2001, ...) for vendors created from now on; older
  // vendors keep the number they already had, and a vendor created before numbering existed has none.
  // This number is the vendor's Sub Account on journal entries (e.g. the Suppliers line of a PO).
  vendorNumber?: number | null;
  name: string;
  type: VendorType;
  balance: number;
  isDeleted: boolean;
  contact: {
    phone: string;
    email?: string;
  };
  address?: {
    country?: string;
    city?: string;
    street?: string;
    postalCode?: string;
  };
  taxInfo?: TaxInfo;
  bankInfo?: BankInfo;
  paymentInfo?: PaymentInfo;
  // All payment (settlement) accounts - several banks / InstaPay / wallets, one primary. paymentInfo
  // mirrors the primary one (kept for older readers).
  paymentAccounts?: VendorPaymentAccount[];
  paymentTerms?: PaymentTerms;
  customPaymentDays?: number | null;
  paymentTermsConfig?: PaymentTermsConfig;
  documents: BusinessDocument[];
  // How payments to this vendor appear in the Cash Flow Statement; null = by the counterpart account
  // (operating). E.g. "Supplier - Finance Activities" = financing.
  cashFlowActivity?: CashFlowActivity | null;
};

export type CashFlowActivity = "operating" | "investing" | "financing";

// Vendor Payment Terms - Lump Sum and Installments (docs section "Vendor Payment Terms").
// Additive and separate from the legacy `paymentTerms`/`customPaymentDays` above - those keep
// governing the existing single `dueDate`; this richer config drives the snapshotted
// `paymentSchedule` on a Purchase Invoice (see backend utils/helpers/paymentSchedule.js).
export type PaymentTermsInstallment = { durationDays: number | string; percentage: number | string };

export type PaymentTermsConfig = {
  kind: "lump_sum" | "installments";
  lumpSum?: { timing: "immediate" | "deferred"; durationDays?: number };
  installments?: PaymentTermsInstallment[];
};
