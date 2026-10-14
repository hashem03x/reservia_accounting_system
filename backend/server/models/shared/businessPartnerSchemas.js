const { Schema } = require('mongoose');

// Shared structures for any "business partner" entity (Customer, Vendor) - tax info, bank info,
// and optional PDF business documents. Kept as plain (non-model) sub-schemas so each parent model
// embeds its own copy, consistent with this codebase's existing convention of embedding
// file/contact metadata directly on the owning document instead of a generic cross-referenced
// model (see productImageSchema on Product, or Vendor.address/contact).

const taxInfoSchema = new Schema(
  {
    taxRegistrationNumber: { type: String, trim: true },
    commercialRegistrationNumber: { type: String, trim: true },
  },
  { _id: false }
);

// Egyptian IBAN: "EG" followed by exactly 27 alphanumeric characters (29 characters total).
// Exported so both the schema-level validator below and the express-validator chains
// (utils/validators/customerValidator.js, utils/validators/vendorValidators.js) check the exact
// same rule - the backend is the source of truth; the frontend's copy of this check is only a UX
// nicety, never the actual enforcement.
const EGYPTIAN_IBAN_REGEX = /^EG[A-Za-z0-9]{27}$/;

// SWIFT/BIC: 4-letter bank code + 2-letter country code + 2-alphanumeric location code, with an
// optional 3-alphanumeric branch code (8 or 11 characters total) - the standard ISO 9362 format.
const SWIFT_CODE_REGEX = /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/;

const bankInfoSchema = new Schema(
  {
    bankName: { type: String, trim: true },
    branch: { type: String, trim: true },
    accountNumber: { type: String, trim: true },
    iban: {
      type: String,
      trim: true,
      uppercase: true,
      validate: {
        // Optional field - only validated when a value is actually provided.
        validator: v => !v || EGYPTIAN_IBAN_REGEX.test(v),
        message: props => `"${props.value}" is not a valid Egyptian IBAN - it must start with "EG", be exactly 29 characters long, and contain only letters and numbers.`,
      },
    },
    swiftCode: {
      type: String,
      trim: true,
      uppercase: true,
      validate: {
        validator: v => !v || SWIFT_CODE_REGEX.test(v),
        message: props => `"${props.value}" is not a valid SWIFT/BIC code.`,
      },
    },
  },
  { _id: false }
);

// Vendor "Payment Information" (docs section "Vendor Payment Information") - a structured
// alternative to the old free-standing `bankInfo` section below, letting a vendor's preferred
// payout method be Instapay, a mobile Wallet, or Bank Details, with exactly one `mode` selected at
// a time. Deliberately ADDITIVE and separate from `bankInfoSchema` above - `bankInfo` is never
// deleted/renamed; existing vendors keep it, and a one-time migration script
// (scripts/migrateVendorPaymentInfo.js) copies it into `paymentInfo.bank` for display continuity.
// This is the vendor's OWN preferred receiving method - never to be confused with the company's
// Chart-of-Accounts cash/bank account used to actually RECORD a payment (Payment.paymentAccount) -
// that posting logic is completely untouched by this field.
const PaymentModes = ['instapay', 'wallet', 'bank'];

// Real, well-known Egyptian mobile wallet providers - stored as a stable internal identifier
// (never a free-text description), matching DOCUMENT_TYPES' identical convention above. 'other' is
// the deliberate escape hatch for a provider not in this list, rather than rejecting the vendor
// entirely.
const WalletProviders = ['vodafone_cash', 'orange_cash', 'etisalat_cash', 'we_pay', 'fawry', 'other'];

const paymentInfoSchema = new Schema(
  {
    mode: { type: String, enum: [...PaymentModes, null], default: null },
    instapay: {
      identifier: { type: String, trim: true }, // Instapay username/mobile/IPA - whatever the vendor registered with.
    },
    wallet: {
      provider: { type: String, enum: [...WalletProviders, null], default: null },
      identifier: { type: String, trim: true }, // The wallet's phone number/account identifier.
    },
    bank: {
      bankName: { type: String, trim: true },
      accountHolderName: { type: String, trim: true },
      accountNumber: { type: String, trim: true },
      iban: {
        type: String,
        trim: true,
        uppercase: true,
        validate: {
          validator: v => !v || EGYPTIAN_IBAN_REGEX.test(v),
          message: props => `"${props.value}" is not a valid Egyptian IBAN - it must start with "EG", be exactly 29 characters long, and contain only letters and numbers.`,
        },
      },
      swiftCode: {
        type: String,
        trim: true,
        uppercase: true,
        validate: {
          validator: v => !v || SWIFT_CODE_REGEX.test(v),
          message: props => `"${props.value}" is not a valid SWIFT/BIC code.`,
        },
      },
    },
  },
  { _id: false }
);

// Stable, bilingual-agnostic internal identifiers - the Arabic/English display label lives only in
// the frontend's localized constants map, never in the database (see task requirement: "Do NOT use
// Arabic strings as database enum values").
const DOCUMENT_TYPES = [
  'commercial_registration',
  'tax_card',
  'electronic_invoice_registration',
  'vat_registration',
  'advance_payments_certificate',
  'authorized_bank_details',
];

const businessDocumentSchema = new Schema({
  documentType: { type: String, enum: DOCUMENT_TYPES, required: true },
  url: { type: String, required: true },
  publicId: { type: String, required: true },
  filename: { type: String },
  mimeType: { type: String },
  uploadedAt: { type: Date, default: Date.now },
});

module.exports = {
  taxInfoSchema,
  bankInfoSchema,
  paymentInfoSchema,
  PaymentModes,
  WalletProviders,
  businessDocumentSchema,
  DOCUMENT_TYPES,
  EGYPTIAN_IBAN_REGEX,
  SWIFT_CODE_REGEX,
};
