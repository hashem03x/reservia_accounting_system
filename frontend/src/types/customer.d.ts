import { BankInfo, BusinessDocument, TaxInfo } from "@/types/document";

export type CustomerType = "online" | "offline";

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
  documents: BusinessDocument[];
};
