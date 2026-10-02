export type AdvancedPaymentType = "customer" | "vendor";
export type AdvancedPaymentStatus = "available" | "partially_used" | "fully_used" | "cancelled";

export interface AdvancedPaymentUsageEntry {
  salesOrder?: { _id: string; code: string; totalAmount: number; paidAmount: number } | null;
  purchaseOrder?: string | null;
  amountConsumed: number;
  reversed: boolean;
  note?: string | null;
  date: string;
}

export interface AdvancedPayment {
  _id: string;
  type: AdvancedPaymentType;
  customer?: { _id: string; name: string; email?: string; phone?: string; customerNumber?: number } | null;
  vendor?: { _id: string; name: string; contact?: { phone?: string; email?: string } } | null;
  project?: { _id: string; projectNumber: string; name?: string } | null;
  amount: number;
  // Always server-derived - never settable from a create/edit form.
  remainingAmount: number;
  currency?: string | null;
  reference?: string | null;
  notes?: string | null;
  status: AdvancedPaymentStatus;
  usageHistory: AdvancedPaymentUsageEntry[];
  createdBy?: { _id: string; name: string };
  createdAt: string;
  updatedAt: string;
}
