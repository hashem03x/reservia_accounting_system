import { BankInfo, BusinessDocument, TaxInfo } from "@/types/document";

export type VendorType = "current" | "equity";

export type Vendor = {
  _id: string;
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
};
