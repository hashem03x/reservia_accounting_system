export type DocumentType =
  | "commercial_registration"
  | "tax_card"
  | "electronic_invoice_registration"
  | "vat_registration"
  | "advance_payments_certificate"
  | "authorized_bank_details";

export type BusinessDocument = {
  _id: string;
  documentType: DocumentType;
  url: string;
  publicId: string;
  filename?: string;
  mimeType?: string;
  uploadedAt: string;
};

export type TaxInfo = {
  taxRegistrationNumber?: string;
  commercialRegistrationNumber?: string;
};

export type BankInfo = {
  bankName?: string;
  branch?: string;
  accountNumber?: string;
  iban?: string;
};
