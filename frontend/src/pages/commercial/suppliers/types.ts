// Deal Engine C18-C24 - shapes returned by /commercial/suppliers (backend models/commercial/supplierModel.js,
// priceListUploadModel.js).
export type SupplierStatus = "Candidate" | "Approved" | "Conditional" | "Suspended" | "Removed";
export const SUPPLIER_STATUSES: SupplierStatus[] = ["Candidate", "Approved", "Conditional", "Suspended", "Removed"];
export const DOCUMENT_KINDS = ["Commercial register", "Tax card", "ISO certificate", "Authorised distributor letter", "Insurance", "Other"];
export const PRICE_BOOK_CATEGORIES = [
  "PV Modules",
  "On-Grid Inverter",
  "Solar Inverter (off-grid)",
  "Off-Grid Inverter",
  "Lithium Batteries",
  "Solar Pump Drive",
  "Pump Motor",
  "DC Cable",
  "AC Cable",
  "AC Distribution Board",
  "AC Breaker",
  "Cable Tray",
  "MC4 Connectors",
  "Mounting Structure",
];
export const STATUS_COLOR: Record<SupplierStatus, string> = { Candidate: "gray", Approved: "teal", Conditional: "yellow", Suspended: "orange", Removed: "red" };

export type Supplier = {
  _id: string;
  code: string;
  legalName: string;
  tradeName: string;
  country: string;
  city: string;
  categories: string[];
  brands: string[];
  contacts: { name: string; role: string; phone: string; email: string }[];
  terms: { paymentTerms: string; currency: "EGP" | "USD" | "EUR" | "CNY"; incoterms: string; leadTimeDays: number | null; minimumOrder: string };
  documents: { _id: string; kind: string; name: string; receivedAt: string | null; expiry: string | null }[];
  status: SupplierStatus;
  approval: { proposedByName: string | null; proposedAt: string | null; approvedByName: string | null; approvedAt: string | null; reviewDate: string | null };
  scorecard: { price: number | null; quality: number | null; delivery: number | null; documentation: number | null; support: number | null; updatedAt: string | null };
  notes?: { at: string; byName: string | null; kind: string; text: string }[];
  reviewFlags: string[];
  createdAt: string;
  // Feature 1.3 - the linked ERP Vendor (populated by the backend), or null/undefined if not yet linked.
  erpVendor?: { _id: string; name: string; vendorNumber: number | null; contact?: { phone?: string } } | null;
};

export type VendorCandidate = { _id: string; name: string; vendorNumber: number | null; contact?: { phone?: string } };

export type PreviewRow = {
  rowNo: number;
  key: string;
  category: string;
  brand: string;
  model: string;
  spec: string;
  unit: string;
  price: number | null;
  currency: string;
  fxRate: number | null;
  egp: number | null;
  current: number | null;
  currentSource: string | null;
  changePct: number | null;
  availability: string;
  leadTimeDays: number | null;
  ratedValue: number | null;
  ratedUnit: string | null;
  validUntil: string | null;
  status: "Update" | "New" | "Unchanged" | "Error";
  errors: string[];
};

export type PriceListUpload = {
  _id: string;
  supplierCode: string;
  // A blanket percentage discount (priceListUploadService.js#applyPercentageDiscount) shows up in
  // this SAME history list, distinguished only by `kind` - everything else (status/changes/
  // flaggedRevisions/rollback) already works unchanged for it.
  kind?: "file" | "discount";
  discountPct?: number | null;
  fileName: string;
  validityDate: string | null;
  mapping: Record<string, string | null>;
  headers: string[];
  rows?: PreviewRow[];
  summary: Record<string, number>;
  status: "previewed" | "confirmed" | "rolledBack";
  uploadedByName: string | null;
  createdAt: string;
  confirmedAt: string | null;
  changes?: { itemKey: string; created: boolean }[];
  flaggedRevisions: number;
  rolledBackAt: string | null;
};

// Price Book fields a file column can map to (backend priceListUploadService.FIELDS).
export const MAPPING_FIELDS: { key: string; en: string; required?: boolean }[] = [
  { key: "category", en: "Category", required: true },
  { key: "brand", en: "Brand", required: true },
  { key: "model", en: "Model", required: true },
  { key: "spec", en: "Spec" },
  { key: "unit", en: "Unit" },
  { key: "unitPrice", en: "Unit price", required: true },
  { key: "currency", en: "Currency" },
  { key: "availability", en: "Availability" },
  { key: "leadTimeDays", en: "Lead time (days)" },
  { key: "minQuantity", en: "Minimum quantity" },
  { key: "ratedValue", en: "Rated value" },
  { key: "ratedUnit", en: "Rated unit" },
  { key: "validityDate", en: "Validity date" },
];

// Go-live Developer Pack 5.4/5.8/D9: "Propose suppliers" gains bdm - mirrors backend
// services/commercial/supplierService.js#EDIT_ROLES exactly.
export const EDIT_ROLES = ["md", "commercial_director", "procurement", "bdm"];
