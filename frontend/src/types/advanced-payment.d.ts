export type AdvancedPaymentType = "customer" | "vendor";
export type AdvancedPaymentStatus = "available" | "partially_used" | "fully_used" | "cancelled";

export interface AdvancedPaymentUsageEntry {
  salesOrder?: { _id: string; code: string; totalAmount: number; grandTotal?: number; paidAmount: number } | null;
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
  vendor?: { _id: string; name: string; vendorNumber?: number | null; contact?: { phone?: string; email?: string } } | null;
  project?: { _id: string; projectNumber: string; name?: string } | null;
  amount: number;
  // Always server-derived - never settable from a create/edit form.
  remainingAmount: number;
  // The Cash/Cash-Equivalent ChartOfAccount this advance was received into/paid from - required for
  // every new advance (docs section "Advanced Payment Payment Method"). Nullable only for advances
  // created before this field existed.
  paymentAccount?: { _id: string; code: string; name: string; nameAr?: string | null } | null;
  currency?: string | null;
  reference?: string | null;
  notes?: string | null;
  status: AdvancedPaymentStatus;
  usageHistory: AdvancedPaymentUsageEntry[];
  createdBy?: { _id: string; name: string };
  createdAt: string;
  updatedAt: string;
}
