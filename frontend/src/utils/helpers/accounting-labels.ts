// Presentation-only label mapping (docs section "Terminology: Sales/Purchase Invoice") - the
// backend's `module` field on a Journal Entry (AccountingModules/AccountingModuleByAction,
// accountingConstants.js) deliberately keeps storing the literal values "Sales Order"/"Purchase
// Order" (no data/enum/migration change), since Journal Entry module values are internal,
// idempotency-adjacent data, not UI copy. This helper only renames what the USER sees wherever a
// Journal Entry's module is rendered, so the rest of the UI (which now says "Sales/Purchase
// Invoice") stays visually consistent - never touches the stored value itself.
export function displayModuleLabel(module: string | null | undefined, translate: (en: string, ar: string) => string): string {
  if (!module) return "-";
  if (module === "Sales Order") return translate("Sales Invoice", "فاتورة مبيعات");
  if (module === "Purchase Order") return translate("Purchase Invoice", "فاتورة مشتريات");
  return module;
}

// Project / G&A classification of a journal entry, as shown to the user. An entry that predates
// the field reads as Project when it has a project; one without a project is "Unclassified" -
// never presented as G&A just because its project is missing (the backend filter
// journalEntryController.js#createJournalEntryFilterObject applies the same rule).
export type EntryClassificationKey = "project" | "ga" | "unclassified";

export function entryClassification(entry: { classification?: string | null; project?: unknown }): EntryClassificationKey {
  if (entry.classification === "ga") return "ga";
  if (entry.classification === "project" || entry.project) return "project";
  return "unclassified";
}

export function entryClassificationLabel(key: EntryClassificationKey, translate: (en: string, ar: string) => string): string {
  if (key === "project") return translate("Project", "مشروع");
  if (key === "ga") return translate("G&A", "عمومية وإدارية");
  return translate("Unclassified", "غير مصنف");
}
