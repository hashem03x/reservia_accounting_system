// An accounting reversal (backend: services/accounting/reversalService.js) - a return, a payment
// reversal or a settlement (advance application) reversal, with the entries it posted.
export type ReversalType = "sales_return" | "purchase_return" | "payment" | "settlement";

type EntryRef = { _id: string; entryNumber: number; date: string; description?: string; status: string };

export interface AccountingReversal {
  _id: string;
  type: ReversalType;
  scope: "full" | "partial";
  reason: string;
  date: string;
  amount: number;
  refundAmount?: number;
  items: {
    product: { _id: string; title?: { en: string; ar: string }; sku?: string } | string;
    quantity: number;
    amount: number;
  }[];
  originalEntries: EntryRef[];
  reversalEntries: EntryRef[];
  notes: string[];
  createdBy?: { _id: string; name: string } | null;
  createdAt: string;
}

/** One order line as the return dialog shows it (sales and purchase orders alike). */
export interface ReturnableLine {
  productId: string;
  title: { en: string; ar: string };
  ordered: number;
  returned: number;
  unitPrice: number;
  isService: boolean;
}
