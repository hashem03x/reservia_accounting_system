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
  createdAt?: string;
};

export type Shareholder = {
  _id: string;
  name: string;
  // The shareholder's Sub Account on equity journal entries.
  shareholderNumber: number;
  ownershipPercentage: number;
  equityAccount?: ChartOfAccountRef | null;
  shareCapital: number;
  contributions: ShareholderContribution[];
  status: ShareholderStatus;
  phone?: string;
  email?: string;
  nationalId?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
};
