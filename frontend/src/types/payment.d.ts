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
  | "currency-transfer";
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
  paymentMethod: PaymentMethod;
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
