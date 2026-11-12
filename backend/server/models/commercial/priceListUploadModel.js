const { Schema, model } = require('mongoose');

// Deal Engine C21-C24 / Spec Part 2 section 5 - one supplier price list upload: what was read, how
// it was mapped, the preview, and (after confirm) every price it changed with the value before, so
// the upload alone can be rolled back. Nothing is written to the Price Book until confirm.
const changeSchema = new Schema(
  {
    item: { type: Schema.Types.ObjectId, ref: 'CommercialMaterialItem', required: true },
    itemKey: { type: String, required: true },
    created: { type: Boolean, default: false }, // the upload created this Price Book item
    before: { type: Schema.Types.Mixed, default: null }, // this supplier's previous price entry, or null
    after: { type: Schema.Types.Mixed, required: true },
  },
  { _id: false }
);

const priceListUploadSchema = new Schema(
  {
    supplier: { type: Schema.Types.ObjectId, ref: 'CommercialSupplier', required: true },
    supplierCode: { type: String, required: true },
    fileName: { type: String, required: true },
    validityDate: { type: Date, default: null }, // the quote validity typed in by Procurement
    mapping: { type: Schema.Types.Mixed, required: true }, // Price Book field -> file header
    headers: { type: [String], default: [] },
    rows: { type: [Schema.Types.Mixed], default: [] }, // preview rows (see priceListUploadService)
    summary: { type: Schema.Types.Mixed, default: {} },
    status: { type: String, enum: ['previewed', 'confirmed', 'rolledBack'], default: 'previewed' },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    uploadedByName: { type: String, default: null },
    confirmedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    confirmedAt: { type: Date, default: null },
    changes: { type: [changeSchema], default: [] },
    flaggedRevisions: { type: Number, default: 0 },
    rolledBackBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    rolledBackAt: { type: Date, default: null },
  },
  { timestamps: true }
);
priceListUploadSchema.index({ supplier: 1, createdAt: -1 });

module.exports = model('CommercialPriceListUpload', priceListUploadSchema);
