const { Schema, model } = require('mongoose');
const { PROPOSAL_VALIDITY_DAYS } = require('../../utils/commercial/constants');

// Reservia Commercial - the issued, customer-facing proposal: a frozen snapshot taken at the
// moment a revision reaches release status APPROVED FOR ISSUE, modeled directly on
// models/crm/quotationModel.js (compute once, store, never recompute on read - so a later Price
// Book change or revision edit can never retroactively alter a proposal the customer already saw).
const commercialProposalSchema = new Schema(
  {
    revision: { type: Schema.Types.ObjectId, ref: 'CommercialRevision', required: true },
    project: { type: Schema.Types.ObjectId, ref: 'CommercialProject', required: true },
    version: { type: Number, required: true, default: 1 },
    issuedAt: { type: Date, required: true, default: Date.now },
    validUntil: { type: Date, required: true },
    // Immutable copies, not live references - taken verbatim from the revision at issue time.
    boqLinesSnapshot: { type: Schema.Types.Mixed, required: true },
    pricingSnapshot: { type: Schema.Types.Mixed, required: true },
    feasibilitySnapshot: { type: Schema.Types.Mixed, default: null },
    pdfAttachmentId: { type: Schema.Types.ObjectId, default: null },
    issuedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

commercialProposalSchema.index({ project: 1, version: -1 });
commercialProposalSchema.index({ revision: 1 });

commercialProposalSchema.statics.validityDays = PROPOSAL_VALIDITY_DAYS;

module.exports = model('CommercialProposal', commercialProposalSchema);
