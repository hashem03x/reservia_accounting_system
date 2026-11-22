const { Schema, model } = require('mongoose');
// Explicit require (not just the string `ref:` name) - mirrors productModel.js's own identical
// comment for its `pucAccount` populate. Without this, any caller that queries CommercialSupplier
// without having separately loaded the Vendor model first hits Mongoose's MissingSchemaError.
require('../vendor/vendor');

// Deal Engine C18 / Spec Part 2 section 4 - the approved supplier list (ASL). The anchor for every
// supplier price in the Price Book (C19) and for the price list upload (C21-C24).
//
// Status: Candidate -> Approved | Conditional -> Suspended | Removed. Only Approved and Conditional
// suppliers can price a BOQ (Conditional only when no Approved price exists, with a flag). Procurement
// proposes; the MD approves (services/commercial/supplierService.js enforces who may set what).

const SUPPLIER_STATUSES = ['Candidate', 'Approved', 'Conditional', 'Suspended', 'Removed'];
const DOCUMENT_KINDS = ['Commercial register', 'Tax card', 'ISO certificate', 'Authorised distributor letter', 'Insurance', 'Other'];

const contactSchema = new Schema(
  {
    name: { type: String, trim: true, maxlength: 120, required: true },
    role: { type: String, trim: true, maxlength: 80, default: '' },
    phone: { type: String, trim: true, maxlength: 40, default: '' },
    email: { type: String, trim: true, lowercase: true, maxlength: 160, default: '' },
  },
  { _id: false }
);

const documentSchema = new Schema(
  {
    kind: { type: String, enum: DOCUMENT_KINDS, required: true },
    name: { type: String, trim: true, maxlength: 200, default: '' },
    receivedAt: { type: Date, default: null },
    expiry: { type: Date, default: null },
    // The scan, stored like any other attachment (attachmentService owner 'commercial-suppliers').
    attachmentId: { type: Schema.Types.ObjectId, default: null },
  },
  { _id: true, timestamps: false }
);

const noteSchema = new Schema(
  {
    at: { type: Date, default: Date.now },
    by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    byName: { type: String, default: null },
    kind: { type: String, enum: ['note', 'status', 'scorecard', 'upload', 'edit', 'document', 'vendor_sync'], default: 'note' },
    text: { type: String, trim: true, maxlength: 2000, required: true },
  },
  { _id: false }
);

const score = { type: Number, min: 1, max: 5, default: null };

const supplierSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, trim: true }, // SUP-NNNN
    legalName: { type: String, required: true, trim: true, maxlength: 200 },
    tradeName: { type: String, trim: true, maxlength: 200, default: '' },
    country: { type: String, trim: true, maxlength: 80, default: 'Egypt' },
    city: { type: String, trim: true, maxlength: 80, default: '' },
    categories: { type: [String], default: [] }, // Price Book categories
    brands: { type: [String], default: [] },
    contacts: { type: [contactSchema], default: [] },
    terms: {
      paymentTerms: { type: String, trim: true, maxlength: 200, default: '' },
      currency: { type: String, enum: ['EGP', 'USD', 'EUR', 'CNY'], default: 'EGP' },
      incoterms: { type: String, trim: true, maxlength: 40, default: '' },
      leadTimeDays: { type: Number, min: 0, default: null },
      minimumOrder: { type: String, trim: true, maxlength: 120, default: '' },
    },
    documents: { type: [documentSchema], default: [] },
    status: { type: String, enum: SUPPLIER_STATUSES, default: 'Candidate' },
    approval: {
      proposedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
      proposedByName: { type: String, default: null },
      proposedAt: { type: Date, default: null },
      approvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
      approvedByName: { type: String, default: null },
      approvedAt: { type: Date, default: null },
      reviewDate: { type: Date, default: null }, // annual review
    },
    scorecard: { price: score, quality: score, delivery: score, documentation: score, support: score, updatedAt: { type: Date, default: null } },
    notes: { type: [noteSchema], default: [] }, // append-only
    // C21: the column mapping of this supplier's last price list, reused on the next upload.
    columnMapping: { type: Schema.Types.Mixed, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    // Feature 1.3 (Deal Engine as the source of truth for shared vendors) - the stable
    // cross-system reference to the real ERP procurement/accounting entity (models/vendor/
    // vendor.js), which this CommercialSupplier is deliberately NEVER merged into: CommercialSupplier
    // owns approval status, categories/brands, scorecard and Price Book pricing; the ERP Vendor
    // keeps owning banking/payment info, vendorNumber, balance and transaction history - this field
    // is only the link between the two, set by supplierService.js's vendor-sync functions (link an
    // existing Vendor, or create one from this supplier's own data), never inferred or auto-matched
    // silently. Deliberately NO `default: null` - mirrors requisitionModel.js#importReference's own
    // comment: Mongoose would then set this to `null` on EVERY document (never actually absent),
    // which defeats the sparse unique index below (a sparse index only skips a field that is
    // genuinely MISSING, not one present with value `null`).
    erpVendor: { type: Schema.Types.ObjectId, ref: 'Vendor' },
  },
  { timestamps: true }
);

supplierSchema.index({ status: 1 });
supplierSchema.index({ legalName: 'text', tradeName: 'text', brands: 'text' });
// A real ERP Vendor must never be the sync target of more than one Supplier at a time (sparse so
// suppliers with no link yet don't collide on `null`).
supplierSchema.index({ erpVendor: 1 }, { unique: true, sparse: true });

// So every list/detail view can show the linked ERP Vendor's identity without a second round trip
// - mirrors materialItemModel.js's identical erpProduct populate.
supplierSchema.pre(/^find/, function (next) {
  this.populate({ path: 'erpVendor', select: 'name vendorNumber contact.phone' });
  next();
});

module.exports = model('CommercialSupplier', supplierSchema);
module.exports.SUPPLIER_STATUSES = SUPPLIER_STATUSES;
module.exports.DOCUMENT_KINDS = DOCUMENT_KINDS;
