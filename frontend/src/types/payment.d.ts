export type PaymentMethod =
  | "cash"
  | "paymob-online"
  | "paymob-offline"
  | "wallet"
  | "band_transfer"
  | "instapay"
  | "fawry"
  | "Banque Misr Deposit"
  | "shopify-payments"
  | "main-bank";

export type PaymentType = "in" | "out";
export type PaymentCategory =
  | "purchase"
  | "purchase-return"
  | "sales"
  | "sales-return"
  | "expense"
  | "transfer"
  | "finance-charges"
  | "currency-transfer"
  | "fixed-asset";
export type PaymentStatus = "unpaid" | "partial" | "paid" | "unknown";

export type Payment = {
  _id: string;
  warehouseId: string;
  purchaseOrderId: string;
  vendorId: string;
  salesOrderId: string;
  customerId: string;
  amountPaid: number;
  type: PaymentType;
  // Legacy/optional - a new payment uses `paymentAccount` instead (docs section "Payment Methods
  // Must Come From Chart of Accounts"). Still present on historical payments.
  paymentMethod?: PaymentMethod | null;
  paymentAccount?: { _id: string; code: string; name: string; nameAr?: string | null } | null;
  paymentCategory: PaymentCategory;
  paidWithPaymob: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: {
    _id: string;
    name: string;
  };
};
