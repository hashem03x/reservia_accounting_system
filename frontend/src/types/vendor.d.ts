import { BankInfo, BusinessDocument, TaxInfo } from "@/types/document";

export type VendorType = "current" | "equity";

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
  documents: BusinessDocument[];
  // How payments to this vendor appear in the Cash Flow Statement; null = by the counterpart account
  // (operating). E.g. "Supplier - Finance Activities" = financing.
  cashFlowActivity?: CashFlowActivity | null;
};

export type CashFlowActivity = "operating" | "investing" | "financing";
