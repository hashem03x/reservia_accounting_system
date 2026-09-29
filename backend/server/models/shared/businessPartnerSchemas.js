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

const bankInfoSchema = new Schema(
  {
    bankName: { type: String, trim: true },
    branch: { type: String, trim: true },
    accountNumber: { type: String, trim: true },
    iban: { type: String, trim: true },
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

module.exports = { taxInfoSchema, bankInfoSchema, businessDocumentSchema, DOCUMENT_TYPES };
