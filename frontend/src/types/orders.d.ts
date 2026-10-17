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
  // = totalAmount + vatAmount - withholdingTaxAmount - the ORDER TOTAL AMOUNT. Always read it through
  // utils/helpers/order-totals.ts#getOrderTotal (handles legacy orders without this field).
  grandTotal?: number;
  // Payment Terms (docs section "Payment Terms for Customers and Vendors") - computed server-side
  // at creation from the customer's/vendor's payment terms at that time, then snapshotted
  // permanently (never recomputed on a later re-save). `null`/absent for a historical order
  // created before this field existed - never backfilled.
  dueDate?: string | null;
}

// =============================================================

export type PurchaseOrder = OrderFinancials & {
  _id: string;
  code?: string; // Optional as old orders don't have a code
  // Nullable: the backend's toJSON transform (purchaseOrder.js) now always carries this key, but as
  // `null` when the referenced Vendor document no longer exists - same reasoning as
  // `SalesOrder.customer`.
  // The PO Supplier IS this Vendor; `vendorNumber` is its Sub Account on the PO's journal entries.
  vendor: { _id: string; name: string; vendorNumber?: number | null; contact?: { phone: string; email?: string } } | null;
  warehouseId: string;
  // The Purchase Order this Invoice was created against (docs section "Link Purchase Invoices to
  // Purchase Orders") - `null` only for a historical invoice created before this link existed.
  requisition?: { _id: string; code: string; status: string; amount: number; invoicedAmount: number } | null;
  items: PurchaseOrderItem[];
  starterTotalAmount: number;
  // Pre-tax SUBTOTAL (legacy field name) - NOT the order amount; see grandTotal.
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
  // docs/entities/products.md). Nullable: Mongoose populate resolves this to `null` when the
  // referenced Product document no longer exists (e.g. hard-deleted outside the app's own
  // soft-delete flow) - a historical order must still render, not crash, when that happens.
  product: {
    _id: string;
    title: { en: string; ar: string };
    price: number;
    priceAfterDiscount: number | null;
    sku?: string;
    barcode?: string;
    // "service" has no stock (returns need no warehouse).
    type?: "product" | "service";
  } | null;
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
  // Nullable: Mongoose populate resolves this to `null` when the referenced User document no
  // longer exists - see `SalesOrderItem.product`'s identical comment.
  customer: Customer | null;
  warehouse: string;
  items: SalesOrderItem[];
  starterTotalAmount: number;
  // Pre-tax SUBTOTAL (legacy field name) - NOT the order amount; see grandTotal.
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
  // docs/entities/products.md). Nullable - see `PurchaseOrderItem.product`'s identical comment.
  product: {
    _id: string;
    title: { en: string; ar: string };
    price: number;
    priceAfterDiscount: number | null;
    sku?: string;
    barcode?: string;
    // "service" has no stock (returns need no warehouse).
    type?: "product" | "service";
  } | null;
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
