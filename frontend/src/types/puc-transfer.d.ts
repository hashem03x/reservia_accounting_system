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
