// VAT Accounting Treatment (backend utils/vatTreatment.js) - mirrors the backend's two values
// exactly. 'recoverable' (default, today's only existing behavior): VAT is posted to its own
// Input VAT ledger line. 'non_recoverable': the same VAT is still calculated, but instead of a
// separate VAT line it is folded into the cost of the purchase/expense/asset it is attached to.
// Purchase-side only (Purchase Invoices, Expenses, Fixed Assets) - a Sales Order's own "No VAT"
// is expressed by its existing vatPercentage/vatExemptReason fields, not this value.
export type VatTreatmentValue = "recoverable" | "non_recoverable";

export const DEFAULT_VAT_TREATMENT: VatTreatmentValue = "recoverable";

export const VAT_TREATMENT_OPTIONS: {
  value: VatTreatmentValue;
  label: { en: string; ar: string };
  description: { en: string; ar: string };
}[] = [
  {
    value: "recoverable",
    label: { en: "14% VAT (Recoverable)", ar: "ضريبة 14% (قابلة للخصم)" },
    description: {
      en: "VAT is recorded separately in the Input VAT account and is recoverable.",
      ar: "تُسجَّل الضريبة بشكل منفصل في حساب ضريبة المدخلات وتكون قابلة للخصم.",
    },
  },
  {
    value: "non_recoverable",
    label: { en: "No VAT (Included in Cost)", ar: "بدون ضريبة (مُضمَّنة في التكلفة)" },
    description: {
      en: "VAT is still calculated but never recorded as recoverable tax - it is included in the cost and is non-recoverable.",
      ar: "تُحسب الضريبة لكنها لا تُسجَّل كضريبة قابلة للخصم - بل تُضاف إلى التكلفة وتكون غير قابلة للخصم.",
    },
  },
];
