// PUC Transfers (backend: services/inventory/pucTransferService.js).
export interface PucTransferOptions {
  product: {
    _id: string;
    title?: { en?: string; ar?: string };
    sku?: string | null;
    type: "product" | "service";
    cost: number | null;
  };
  warehouses: { _id: string; name: string | null; quantity: number }[];
  // Materials cost still held in Materials Inventory (not yet in any project's PUC).
  materialsInventoryBalance: number;
  // When a source project was given: the quantity of this product in that project's PUC.
  sourceProjectQuantity?: number;
}

// Project-oriented inventory view (backend: services/inventory/pucTransferService.js#listProjectInventory).
export interface ProjectInventoryRow {
  _id: string;
  product: {
    _id: string;
    title: { en: string; ar: string };
    category: string | null;
    brand: string | null;
    model: string | null;
    sku: string | null;
    classification: "product" | "service";
  } | null;
  sourceType: "purchase-order" | "warehouse" | "project" | "purchase-return";
  quantity: number;
  unitCost: number;
  amount: number;
  purchaseOrder: {
    _id: string;
    code: string;
    date: string;
    vendor: { _id: string; name: string; vendorNumber?: number | null } | null;
  } | null;
  warehouse: { _id: string; name: string } | null;
  date: string;
}

export interface ProjectInventoryResult {
  project: { _id: string; projectNumber: string; name: string | null };
  summary: {
    totalQuantityPurchased: number;
    totalQuantityReturned: number;
    netQuantity: number;
    totalAmount: number;
    quantityUsed: number | null;
    quantityRemaining: number | null;
  };
  pagination: { page: number; limit: number; total: number; totalPages: number };
  data: ProjectInventoryRow[];
}

export interface PucTransfer {
  _id: string;
  quantity: number;
  unitCost: number;
  amount: number;
  sourceType: "warehouse" | "project";
  warehouse?: { _id: string; name: string } | null;
  sourceProject?: { _id: string; projectNumber: string; name?: string } | null;
  project: { _id: string; projectNumber: string; name?: string };
  date: string;
  notes?: string;
  journalEntry: { _id: string; entryNumber: number; status: string };
  createdBy?: { _id: string; name: string } | null;
  createdAt: string;
}
