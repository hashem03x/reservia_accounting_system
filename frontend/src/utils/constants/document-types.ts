import { Language } from "@/types/language";
import { LocalizedEntity } from "@/types/global";
import { DocumentType } from "@/types/document";
import translate from "@/utils/helpers/translate";

// Stable internal identifiers matching the backend's DOCUMENT_TYPES enum (see
// backend/server/models/shared/businessPartnerSchemas.js) - the Arabic/English display label
// lives ONLY here, never as a database value.
const documentTypes: LocalizedEntity<DocumentType> = {
  commercial_registration: {
    value: "commercial_registration",
    label: { en: "Commercial Registration", ar: "السجل التجاري" },
  },
  tax_card: {
    value: "tax_card",
    label: { en: "Tax Card", ar: "البطاقة الضريبية" },
  },
  electronic_invoice_registration: {
    value: "electronic_invoice_registration",
    label: { en: "Electronic Invoice Registration", ar: "شهادة تسجيل الفاتورة الإلكترونية" },
  },
  vat_registration: {
    value: "vat_registration",
    label: { en: "VAT Registration", ar: "شهادة تسجيل القيمة المضافة" },
  },
  advance_payments_certificate: {
    value: "advance_payments_certificate",
    label: { en: "Advance Payments Certificate", ar: "شهادة الدفعات المقدمة" },
  },
  authorized_bank_details: {
    value: "authorized_bank_details",
    label: { en: "Authorized Bank Details", ar: "مستند معتمد ببيانات البنك" },
  },
};

export default documentTypes;

export const documentTypesArray = Object.values(documentTypes);

export const getDocumentTypeLabel = (documentType: DocumentType, language: Language) => {
  return translate(language, documentTypes[documentType].label.en, documentTypes[documentType].label.ar);
};
