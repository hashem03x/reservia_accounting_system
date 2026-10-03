import { Customer } from "./customer";
import { PaymentStatus } from "./payment";
import { Address } from "./user";

export type DiscountType = "percentage" | "fixed";
export type ItemDiscount = { type: DiscountType; value: number };
export type OrderSource = "cashier" | "website" | "shopify"; // For Sales Orders
export type OrderStatus = "pending" | "delivered" | "canceled";

// 'account' = paid via a Cash/Cash-Equivalent ChartOfAccount (see `paymentAccount`).
// 'advanced_payment' = Sales Order only - paid via the customer's AdvancedPayment balance.
export type OrderPaymentMethod = "account" | "advanced_payment";

export type ChartOfAccountRef = { _id: string; code: string; name: string; nameAr?: string | null };

// Shared by both Sales Orders and Purchase Orders (docs sections "VAT on Sales Orders and Purchase
// Orders" / "Withholding Tax" / "Payment Methods Must Come From Chart of Accounts" / "Add Project
// Number") - `vatAmount`/`withholdingTaxAmount`/`grandTotal` are always server-computed, never
// editable from a form.
export interface OrderFinancials {
  project?: { _id: string; projectNumber: string; name?: string } | null;
  paymentMethod?: OrderPaymentMethod | null;
  paymentAccount?: ChartOfAccountRef | null;
  vatPercentage?: number;
  vatAmount?: number;
  withholdingTaxPercentage?: number;
  withholdingTaxAmount?: number;
  // = totalAmount + vatAmount - withholdingTaxAmount
  grandTotal?: number;
}

// =============================================================

export type PurchaseOrder = OrderFinancials & {
  _id: string;
  code?: string; // Optional as old orders don't have a code
  vendor: { _id: string; name: string; contact: { phone: string; email?: string } };
  warehouseId: string;
  items: PurchaseOrderItem[];
  starterTotalAmount: number;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  paymentStatus: PaymentStatus;
  createdBy?: { _id: string; name: string };
  createdAt: string;
  updatedAt: string;
};

export type PurchaseOrderItem = {
  _id: string;
  // A Product is the sellable/stock-tracked item itself now - there is no separate Variant (see
  // docs/entities/products.md).
  product: {
    _id: string;
    title: { en: string; ar: string };
    price: number;
    priceAfterDiscount: number | null;
    sku?: string;
    barcode?: string;
  };
  unitPrice: number;
  itemDiscount: ItemDiscount;
  unitPriceAfterDiscount: number;
  starterQuantity: number;
  starterSubtotal: number;
  returnedQuantity: number;
  subtotal: number;
};

// =============================================================

export type SalesOrder = OrderFinancials & {
  _id: string;
  code?: string; // Optional as old orders don't have a code
  orderSource: OrderSource;
  isPrepaid: boolean;
  customer: Customer;
  warehouse: string;
  items: SalesOrderItem[];
  starterTotalAmount: number;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  paymentStatus: PaymentStatus;
  createdBy?: { _id: string; name: string };
  createdAt: string;
  updatedAt: string;

  shippingCost: number;
  shippingCostPaid: boolean;
  starterTotalAmountPlusShipping: number;
  totalAmountPlusShipping: number;
  orderStatus: OrderStatus;
  deliveryDate?: string;
  isCodOrder: boolean;
  isCodOrderConfirmed: boolean;
  needCardReader: boolean;

  // For Website Orders
  shippingAddress?: Address;
  couponDiscount: number; // Persentage
};

export type SalesOrderItem = {
  _id: string;
  // A Product is the sellable/stock-tracked item itself now - there is no separate Variant (see
  // docs/entities/products.md).
  product: {
    _id: string;
    title: { en: string; ar: string };
    price: number;
    priceAfterDiscount: number | null;
    sku?: string;
    barcode?: string;
  };
  unitPrice: number;
  itemDiscount: ItemDiscount;
  unitPriceAfterDiscount: number;
  starterQuantity: number;
  starterSubtotal: number;
  returnedQuantity: number;
  subtotal: number;

  // For Website Orders
  quantityToBeReturned: number;
};

// =============================================================

export type ReturnRecord = {
  _id: string;
  productId: string;
  returnedQuantity: number;
  returnedAmount: number;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
};
