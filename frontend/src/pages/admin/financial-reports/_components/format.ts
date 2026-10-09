import paths from "@/utils/constants/paths";
import { ReportColumn, ReportLinkKind, ReportRow } from "@/types/accounting-report";

// Shared by the on-screen tables and the print view, so both show exactly the same text.

const number2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const number0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

/** "1,234.50", negatives as "(1,234.50)" - the accounting convention. */
export function formatMoney(value: number) {
  return value < 0 ? `(${number2.format(-value)})` : number2.format(value);
}

/** The text of a row cell in the current language: `${key}Ar` when Arabic and present. */
export function cellText(row: ReportRow, key: string, isArabic: boolean): unknown {
  return isArabic && row[`${key}Ar`] != null ? row[`${key}Ar`] : row[key];
}

/**
 * A cell as display text. `null`/`undefined` on a figure column is unavailable data ("n/a"),
 * never shown as zero.
 */
export function formatCell(column: ReportColumn, row: ReportRow, isArabic: boolean): string {
  const value = cellText(row, column.key, isArabic);
  const figure = column.type === "money" || column.type === "percent";
  if (value === null || value === undefined || value === "") return figure ? (isArabic ? "غير متاح" : "n/a") : "";
  if (column.type === "money" && typeof value === "number") return formatMoney(value);
  if (column.type === "percent" && typeof value === "number") return `${number2.format(value)}%`;
  if (column.type === "number" && typeof value === "number") return number0.format(value);
  if (column.type === "date") return String(value).slice(0, 10);
  return String(value);
}

export const isFigure = (column: ReportColumn) => ["money", "percent", "number"].includes(column.type);

const LINKS: Record<ReportLinkKind, ((id: string) => string) | null> = {
  project: (id) => `/${paths.admin}/${paths.projects}/${id}`,
  customer: (id) => `/${paths.admin}/${paths.home}/${paths.customers}/${id}`,
  vendor: (id) => `/${paths.admin}/${paths.home}/${paths.vendors}/${id}`,
  shareholder: (id) => `/${paths.admin}/${paths.shareholders}/${id}`,
  journalEntry: (id) => `/${paths.admin}/${paths.journalEntries}/${id}`,
  salesOrder: (id) => `/${paths.admin}/${paths.home}/${paths.salesOrders}/${id}`,
  purchaseOrder: (id) => `/${paths.admin}/${paths.home}/${paths.purchaseOrders}/${id}`,
  fixedAsset: (id) => `/${paths.admin}/${paths.fixedAssets}/${id}`,
  account: null, // the Chart of Accounts has no per-account page
};

export function linkOf(row: ReportRow, key: string): string | null {
  const link = row._links?.[key];
  if (!link) return null;
  const build = LINKS[link.kind];
  return build ? build(link.id) : null;
}

/** Today in UTC (the reports' day boundary) as YYYY-MM-DD. */
export const todayUtc = () => new Date().toISOString().slice(0, 10);
