const { Schema, model } = require('mongoose');
const { APPROVAL_STAGES, APPROVAL_STATUSES } = require('../../utils/commercial/constants');

// Reservia Commercial - append-only approval audit log (Developer Brief section 4.1: "Changes
// never overwrite earlier rows"). services/commercial/approvalService.js only ever INSERTS here;
// the current status for display lives (denormalized) on the revision's own stage1/stage2/md
// fields, which this log is the source of truth for. A later edit to a signed-off revision resets
// that revision's stage field to Pending AND appends a new row here - the earlier Approved row is
// never touched.
const commercialApprovalSchema = new Schema(
  {
    revision: { type: Schema.Types.ObjectId, ref: 'CommercialRevision', required: true },
    stage: { type: String, enum: APPROVAL_STAGES, required: true },
    status: { type: String, enum: APPROVAL_STATUSES, required: true },
    approver: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    decidedAt: { type: Date, required: true, default: Date.now },
    note: { type: String, default: '' },
    // Value at the moment of decision - lets a later viewer see what the figures were when this
    // specific sign-off happened, even if the revision's live numbers have since moved on.
    valueSnapshot: {
      netExclVat: { type: Number, default: null },
      grossProfitPct: { type: Number, default: null },
    },
  },
  { timestamps: true }
);

commercialApprovalSchema.index({ revision: 1, createdAt: 1 });

module.exports = model('CommercialApproval', commercialApprovalSchema);
