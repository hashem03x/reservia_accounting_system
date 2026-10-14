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
