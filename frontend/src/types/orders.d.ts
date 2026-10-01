import { Customer } from "./customer";
import { PaymentStatus } from "./payment";
import { ProductColor } from "./product";
import { Address } from "./user";

export type DiscountType = "percentage" | "fixed";
export type ItemDiscount = { type: DiscountType; value: number };
export type OrderSource = "cashier" | "website" | "shopify"; // For Sales Orders
export type OrderStatus = "pending" | "delivered" | "canceled";

// =============================================================

export type PurchaseOrder = {
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

export type SalesOrder = {
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
    colors: ProductColor[];
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
