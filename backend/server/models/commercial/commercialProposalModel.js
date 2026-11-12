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
    // <deal #>-P<nn> (services/commercial/dealNumberService.js). Absent on proposals issued before deal numbers existed.
    proposalNumber: { type: String, trim: true, default: null },
    issuedAt: { type: Date, required: true, default: Date.now },
    validUntil: { type: Date, required: true },
    // Immutable copies, not live references - taken verbatim from the revision at issue time.
    boqLinesSnapshot: { type: Schema.Types.Mixed, required: true },
    pricingSnapshot: { type: Schema.Types.Mixed, required: true },
    feasibilitySnapshot: { type: Schema.Types.Mixed, default: null },
    pdfAttachmentId: { type: Schema.Types.ObjectId, default: null },
    // Deal Engine C15/C17: the stored customer PDF's SHA-256 and size, the frozen document data (the
    // internal copy re-renders from it), the CRM lead copy, and a release override note (C20).
    pdfHash: { type: String, default: null },
    pdfSize: { type: Number, default: null },
    documentSnapshot: { type: Schema.Types.Mixed, default: null },
    leadAttachmentId: { type: Schema.Types.ObjectId, default: null },
    leadAttachmentError: { type: String, default: null },
    releaseOverride: { type: String, default: null },
    issuedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

commercialProposalSchema.index({ project: 1, version: -1 });
// One P01, one P02... per project, even when two issues race (Deal Engine C15).
commercialProposalSchema.index({ project: 1, version: 1 }, { unique: true, name: 'project_version_unique' });
commercialProposalSchema.index({ revision: 1 });

commercialProposalSchema.statics.validityDays = PROPOSAL_VALIDITY_DAYS;

module.exports = model('CommercialProposal', commercialProposalSchema);
