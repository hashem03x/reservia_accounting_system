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
  swiftCode?: string;
};

export type PaymentMode = "instapay" | "wallet" | "bank";
export type WalletProvider = "vodafone_cash" | "orange_cash" | "etisalat_cash" | "we_pay" | "fawry" | "other";

// Vendor "Payment Information" (docs section "Vendor Payment Information") - additive, separate
// from BankInfo above, which is never deleted/renamed. Exactly one `mode` at a time.
export type PaymentInfo = {
  mode?: PaymentMode | null;
  instapay?: { identifier?: string };
  wallet?: { provider?: WalletProvider | null; identifier?: string };
  bank?: { bankName?: string; accountHolderName?: string; accountNumber?: string; iban?: string; swiftCode?: string };
};
