// The "Purchase Order" document (docs section "Implement Purchase Orders Before Purchase
// Invoices") - internally named Requisition on the backend because the model name `PurchaseOrder`
// is already taken by the existing Purchase Invoice (see backend requisitionModel.js's header
// comment). Purely operational: no tax/payment fields, never posts accounting.
import type { DocumentPaymentTerms, PaymentSchedule } from "@/utils/helpers/document-payment-terms";

export type RequisitionStatus = "draft" | "open" | "cancelled";
// Derived display status (never stored) - see the backend model's toJSON transform.
export type RequisitionEffectiveStatus = "draft" | "open" | "partially_invoiced" | "fully_invoiced" | "cancelled";

export interface RequisitionItem {
  product?: { _id: string; title?: { en: string; ar: string }; type?: "product" | "service"; category?: string; subcategory?: string; brand?: string; model?: string; specifications?: string; sku?: string } | null;
  description: string;
  quantity: number;
  unit?: string | null;
  unitPrice: number;
  lineTotal: number;
}

// Shape sent to the API when creating/editing a Purchase Order's line items.
export interface RequisitionItemInput {
  product?: string | null;
  description: string;
  quantity: number | string;
  unit?: string;
  unitPrice: number | string;
}

export interface Requisition {
  _id: string;
  code: string;
  vendorId: { _id: string; name: string; vendorNumber?: number | null; contact?: { phone?: string; email?: string } } | null;
  project: { _id: string; projectNumber: string; name?: string } | null;
  items: RequisitionItem[];
  // = sum of items[].lineTotal - always server-computed.
  amount: number;
  // The date installment tenors are counted from (older Purchase Orders: their creation date).
  issueDate?: string | null;
  // Vendor payment terms of this Purchase Order and the schedule derived from its current value.
  paymentTerms?: DocumentPaymentTerms | null;
  paymentSchedule?: PaymentSchedule | null;
  notes?: string;
  status: RequisitionStatus;
  // The ONE cached/mutable field (atomically incremented by linked Purchase Invoices) - everything
  // below is derived from it, never independently stored.
  invoicedAmount: number;
  remainingAmount: number;
  executedPercentage: number;
  effectiveStatus: RequisitionEffectiveStatus;
  createdBy?: { _id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
}
