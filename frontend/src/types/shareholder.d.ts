import { ChartOfAccountRef } from "@/types/orders";
import { JournalEntryRef } from "@/types/fixed-asset";

export type ShareholderStatus = "active" | "inactive";

// One capital contribution: Dr the payment account / Cr the equity account.
export type ShareholderContribution = {
  _id: string;
  amount: number;
  date: string;
  paymentAccount: ChartOfAccountRef | string;
  equityAccount: ChartOfAccountRef | string;
  journalEntry: string | JournalEntryRef;
  reference?: string;
  notes?: string;
  idempotencyKey?: string | null;
  createdAt?: string;
};

export type Shareholder = {
  _id: string;
  name: string;
  nameAr?: string | null;
  address?: string | null;
  // The shareholder's Sub Account on equity journal entries.
  shareholderNumber: number;
  ownershipPercentage: number;
  equityAccount?: ChartOfAccountRef | null;
  // Total actually paid in - the sum of `contributions`.
  shareCapital: number;
  // Computed server-side from ownershipPercentage x the company's Issued Capital - always
  // read-only, null when Issued Capital has not been set yet (see types/company-capital.d.ts).
  allocatedCapital?: number | null;
  // allocatedCapital - shareCapital, also computed, also null until Issued Capital is set.
  remainingUnpaid?: number | null;
  contributions: ShareholderContribution[];
  status: ShareholderStatus;
  phone?: string;
  email?: string;
  nationalId?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
};
