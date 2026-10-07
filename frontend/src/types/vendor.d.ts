import { BankInfo, BusinessDocument, TaxInfo } from "@/types/document";

export type VendorType = "current" | "equity";

export type Vendor = {
  _id: string;
<<<<<<< HEAD
  // The vendor's own number - 5 digits starting with 2 (2xxxx) for vendors created from now on; older
  // vendors keep the number they already had, and a vendor created before numbering existed has none.
  // This number is the vendor's Sub Account on journal entries (e.g. the Suppliers line of a PO).
  vendorNumber?: number | null;
=======
>>>>>>> 368811657e0eba1f2e8b46ee732d01745194d628
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
