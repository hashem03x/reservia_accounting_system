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

    // ---- Deal identifier chain (Developer Brief 5/6.1 + the reference build's "Leads and ID
    // chain"): Lead # (CRM) -> Commercial deal # -> Proposal # (deal # + revision suffix) -> ERP
    // project # (proposed now, the real one returned by the ERP when its project is created).
    dealNumber: { type: String, trim: true, default: undefined },
    proposalNumber: { type: String, trim: true, default: null }, // the number the next/last issued proposal carries
    proposedErpProjectNumber: { type: String, trim: true, default: null },
    // Set ONLY when a real ERP project exists and is linked - never fabricated (QA / brief 6.2).
    erpProject: { type: Schema.Types.ObjectId, ref: 'Project', default: null },
    erpProjectNumber: { type: String, trim: true, default: null },

    // ---- CRM linkage (QA finding B5). Idempotency key for the handoff: one lead -> one project.
    crmLead: { type: Schema.Types.ObjectId, ref: 'CrmLead', default: undefined },
    crmLeadRef: { type: String, trim: true, default: null },
    crmSync: {
      status: { type: String, enum: ['synced', 'failed', null], default: null },
      lastEvent: { type: String, enum: ['proposal', 'won', 'lost', null], default: null },
      lastSyncAt: { type: Date, default: null },
      lastError: { type: String, default: null },
    },
    // Prefilled from the lead at handoff - an estimate for the estimator, never a priced figure.
    estimatedValueEgp: { type: Number, min: 0, default: null },
    estimatedKwp: { type: Number, min: 0, default: null },
    leadSource: { type: String, trim: true, default: null },
    leadCampaign: { type: String, trim: true, default: null },
    // e.g. "Region mapped from governorate Alexandria (nearest Rates region) - confirm install/transport rates."
    regionNote: { type: String, trim: true, default: null },

    // ---- Register outcome (brief 5 RegisterRow / 6.1 Won-Lost events).
    outcome: { type: String, enum: ['Open', 'Won', 'Lost'], default: 'Open' },
    outcomeAt: { type: Date, default: null },
    lostReason: { type: String, trim: true, default: null },
    wonValueEgp: { type: Number, default: null },
    // Cost-only ERP budget lines captured on Won (brief 3.5 / 6.2: "Profit is never sent"). A
    // snapshot for the ERP project setup - creating it here posts NOTHING to accounting.
    erpBudget: {
      lines: { type: [{ costCode: String, line: String, budgetEgp: Number, _id: false }], default: undefined },
      totalBudgetEgp: { type: Number, default: null },
      check: { type: Number, default: null },
      capturedAt: { type: Date, default: null },
      revision: { type: Schema.Types.ObjectId, ref: 'CommercialRevision', default: null },
    },

    // ---- Edit audit trail (QA finding B1) - append-only, newest last.
    editHistory: {
      type: [
        {
          at: { type: Date, required: true },
          by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
          byName: { type: String, default: null },
          changes: [{ field: String, from: Schema.Types.Mixed, to: Schema.Types.Mixed, _id: false }],
          revisionReset: { type: Boolean, default: false },
          _id: false,
        },
      ],
      default: [],
    },
  },
  { timestamps: true }
);

commercialProjectSchema.index({ dealNumber: 1 }, { unique: true, partialFilterExpression: { dealNumber: { $type: 'string' } } });
// One CRM lead can never create two Commercial projects (QA B5: "Idempotent on the CRM lead ID").
commercialProjectSchema.index({ crmLead: 1 }, { unique: true, partialFilterExpression: { crmLead: { $type: 'objectId' } } });
commercialProjectSchema.index({ outcome: 1, archived: 1 });

commercialProjectSchema.index({ category: 1, archived: 1 });
commercialProjectSchema.index({ customer: 1 });
commercialProjectSchema.index({ createdAt: -1 });
commercialProjectSchema.index({ name: 'text', projectCode: 'text' });

commercialProjectSchema.pre(/^find/, function (next) {
  this.populate({ path: 'customer', select: 'name email phone customerNumber' }).populate({ path: 'createdBy', select: 'name' }).populate({ path: 'designerUser', select: 'name' });
  next();
});

module.exports = model('CommercialProject', commercialProjectSchema);
