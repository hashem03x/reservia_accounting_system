// GET purchaseOrder/:id/project-allocation (backend: services/inventory/poProjectAllocationService.js).
export interface PurchaseOrderAllocation {
  status: "allocated" | "not_applicable" | null;
  at: string | null;
  project: { _id: string; projectNumber: string | null } | null;
  journalEntry: { _id: string; entryNumber: number; status: string } | null;
  lines: {
    itemId: string;
    product: { _id: string; title?: { en?: string; ar?: string }; type: "product" | "service" } | null;
    stock: boolean;
    ordered: number;
    received: number;
    returned: number;
    allocated: number;
    unallocated: number;
    unreceived: number;
    records: {
      _id: string;
      sourceType: "purchase-order" | "purchase-return";
      quantity: number;
      date: string;
      journalEntry: string | null;
    }[];
  }[];
}

// GET purchaseOrder/:id/payments (backend: services/purchases/purchaseOrderPaymentService.js).
export type PurchaseOrderPaymentStatus = "unpaid" | "partially_paid" | "paid" | "overpaid";
export interface PurchaseOrderPayments {
  summary: {
    grossBeforeDiscount: number;
    discounts: number;
    returns: number;
    subtotal: number;
    vatPercentage: number;
    vat: number;
    withholdingPercentage: number;
    withholding: number;
    total: number;
    totalPaid: number;
    paidBeforeRefunds: number;
    refunded: number;
    outstanding: number;
    creditBalance: number;
    unappliedPayments: number;
    status: PurchaseOrderPaymentStatus;
    storedPaidAmount: number;
    storedStatus: string | null;
    currency: string;
  };
  payments: {
    _id: string;
    date: string;
    reference: string | null;
    kind: "payment" | "refund" | "advance";
    method: string | null;
    paymentMethod: string | null;
    paymentAccount: { _id: string; code: string; name: string; nameAr?: string | null } | null;
    currency: string;
    amount: number;
    allocated: number;
    status: "posted" | "reversed" | "recorded";
    journalEntry: { _id: string; entryNumber: number } | null;
    reversalEntry: { _id: string; entryNumber: number; date: string } | null;
  }[];
}

// GET vendors/:id/expenses (backend: services/expenses/vendorExpenseService.js).
export type VendorExpenseStatus = "unpaid" | "partially_paid" | "paid" | "cancelled";
export interface VendorExpenses {
  totals: {
    count: number;
    amount: number;
    vat: number;
    total: number;
    paid: number;
    outstanding: number;
    cancelled: number;
  };
  expenses: {
    _id: string;
    date: string;
    reference: string | null;
    category: { _id: string; name: string; nameAr?: string | null } | null;
    expenseAccount: { code: string; name: string } | null;
    description: string | null;
    projectNumber: string | null;
    currency: string;
    amount: number;
    vat: number;
    total: number;
    paid: number;
    outstanding: number;
    paymentStatus: VendorExpenseStatus;
    journalEntry: { _id: string; entryNumber: number; status: string } | null;
  }[];
}

// GET fixed-assets/depreciation/runs
export interface DepreciationRunRecord {
  _id: string;
  period: string;
  totalAmount: number;
  processed: { name: string; amount: number; entryNumber: number; journalEntry: string }[];
  skipped: { name: string; reason: string }[];
  missingEarlierMonths: { name: string; periods: string[] }[];
  createdBy?: { _id: string; name: string } | null;
  createdAt: string;
}
