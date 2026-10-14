import { BankInfo, BusinessDocument, TaxInfo } from "@/types/document";

export type CustomerType = "online" | "offline";

// Payment Terms (docs section "Payment Terms for Customers and Vendors") - mirrors Vendor's
// identical field exactly (same values, same default 'Net 30').
export type PaymentTerms = "Immediate" | "Net 15" | "Net 30" | "Net 45" | "Net 60" | "Custom";

export type Customer = {
  _id: string;
  name: string;
  balance: number;
  isDeleted: boolean;
  type: CustomerType;
  phone: string;
  additionalPhone: string;
  email?: string;
  /** Server-generated, immutable once assigned - see docs/entities/customers.md. Absent on staff/non-"user" accounts. */
  customerNumber?: number;
  offlineAddress?: {
    country?: string;
    city?: string;
    street?: string;
    postalCode?: string;
  };
  taxInfo?: TaxInfo;
  bankInfo?: BankInfo;
  paymentTerms?: PaymentTerms;
  customPaymentDays?: number | null;
  documents: BusinessDocument[];
};
