// Accounting reports (backend: services/reports/*, GET /accounting-reports/:key). Every report
// shares this shape, so one viewer renders all of them.

export type LocalizedText = { en: string; ar: string };

export type ReportKind = "period" | "asOf" | "list";

export type ReportFilterName =
  | "period"
  | "asOf"
  | "customer"
  | "vendor"
  | "project"
  | "sector"
  | "projectStatus"
  | "cashAccount"
  | "expenseAccount"
  | "expenseType"
  | "orderStatus"
  | "paymentStatus"
  | "termDays"
  | "byProject"
  | "includeZero"
  | "assetStatus"
  | "assetClass"
  | "taxAccount"
  | "taxMovement"
  | "taxSource"
  | "taxReference"
  | "expenseCategory"
  | "glAccount"
  | "entryNumber"
  | "glSearch"
  | "glSort"
  | "pucCategory"
  | "pucAccount"
  | "pucSource";

export type ReportCatalogEntry = { key: string; kind: ReportKind; title: LocalizedText; filters: ReportFilterName[] };
export type ReportCatalog = { categories: { key: string; title: LocalizedText; reports: ReportCatalogEntry[] }[] };

export type ReportColumnType = "text" | "money" | "number" | "percent" | "date" | "status" | "account" | "name" | "longtext";
export type ReportColumn = { key: string; label: LocalizedText; type: ReportColumnType };

export type ReportLinkKind =
  | "project"
  | "customer"
  | "vendor"
  | "shareholder"
  | "journalEntry"
  | "salesOrder"
  | "purchaseOrder"
  | "fixedAsset"
  | "account";

export type ReportRow = Record<string, unknown> & {
  _rowType?: "header" | "subtotal" | "total" | "muted" | "item";
  _links?: Record<string, { kind: ReportLinkKind; id: string }>;
  _noteId?: string;
};

export type ReportSection = {
  key: string;
  title: LocalizedText;
  columns: ReportColumn[];
  rows: ReportRow[];
  totals: ReportRow | null;
  paginate?: boolean;
  manual?: boolean;
  pagination?: { page: number; pageSize: number; totalRows: number; totalPages: number };
};

export type ReportResult = {
  key: string;
  category: string;
  categoryTitle: LocalizedText;
  kind: ReportKind;
  title: LocalizedText;
  filters: Record<string, string>;
  generatedAt: string;
  currency: string;
  period?: { from: string; to: string };
  asOf?: string;
  summary: { key: string; label: LocalizedText; value: number | null; type: "money" | "number" | "percent" }[];
  checks: { label: LocalizedText; ok: boolean; detail: string | null }[];
  sections: ReportSection[];
  notes: LocalizedText[];
  chart?: { labelKey: string; valueKey: string };
};

export type DisclosureNote = {
  _id: string;
  title: string;
  titleAr?: string;
  body: string;
  bodyAr?: string;
  sortOrder: number;
  isActive: boolean;
};
