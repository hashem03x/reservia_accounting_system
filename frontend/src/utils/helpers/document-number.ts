// ERP CHG-11 - one document number per type, shown everywhere a user sees a reference. The three
// document types each have their own counter (backend services/shared/orderNumberService.js), so the
// same 12-digit number can exist as a sales invoice, a purchase invoice and a purchase order; the
// prefix tells them apart. Stored codes are unchanged (they are looked up by code and imported), so
// the prefix is added for display only.
export type DocumentKind = "salesInvoice" | "purchaseInvoice" | "purchaseOrder";

export const DOCUMENT_PREFIX: Record<DocumentKind, string> = { salesInvoice: "SI", purchaseInvoice: "PI", purchaseOrder: "PO" };

/** "SI-000000000005" for a sales invoice coded "000000000005"; "-" when there is no code. */
export function documentNumber(kind: DocumentKind, code: string | null | undefined): string {
  if (!code) return "-";
  const prefix = DOCUMENT_PREFIX[kind];
  return code.startsWith(`${prefix}-`) ? code : `${prefix}-${code}`;
}
