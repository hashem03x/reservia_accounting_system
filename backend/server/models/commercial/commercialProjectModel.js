const { Schema, model } = require('mongoose');
const { CATEGORIES, SCOPES } = require('../../utils/commercial/constants');

// Reservia Commercial - the stable project header. Reuses the existing User collection for the
// customer reference (role 'user', per userModel.js) rather than a duplicate Customer model -
// same convention Sales/Purchase already follow. Engineering calculations, BOQ, pricing and
// feasibility all live on the CURRENT CommercialRevision (commercialRevisionModel.js), never on
// this header - the header only tracks which revision is current and a fast-glance approval
// rollup for list views.
const commercialProjectSchema = new Schema(
  {
    projectCode: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    customer: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    country: { type: String, required: true, trim: true },
    region: { type: String, trim: true, default: null },
    category: { type: String, required: true, enum: CATEGORIES },
    subCategory: { type: String, trim: true, default: null },
    currency: { type: String, required: true, default: 'EGP' },
    fxRate: { type: Number, default: null, min: 0 },
    scope: { type: String, enum: SCOPES, default: 'Supply & Installation' },
    designerUser: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    currentRevision: { type: Schema.Types.ObjectId, ref: 'CommercialRevision', default: null },
    // Fast-glance rollup only - the authoritative per-stage status lives on the current revision
    // (commercialRevisionModel.js) and its append-only approval log (commercialApprovalModel.js).
    engineeringApprovalRollup: { type: String, enum: ['PENDING', 'APPROVED'], default: 'PENDING' },
    commercialApprovalRollup: { type: String, enum: ['PENDING', 'APPROVED'], default: 'PENDING' },
    archived: { type: Boolean, default: false },
    archivedAt: { type: Date, default: null },
    archivedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

commercialProjectSchema.index({ category: 1, archived: 1 });
commercialProjectSchema.index({ customer: 1 });
commercialProjectSchema.index({ createdAt: -1 });
commercialProjectSchema.index({ name: 'text', projectCode: 'text' });

commercialProjectSchema.pre(/^find/, function (next) {
  this.populate({ path: 'customer', select: 'name email phone customerNumber' }).populate({ path: 'createdBy', select: 'name' });
  next();
});

module.exports = model('CommercialProject', commercialProjectSchema);
