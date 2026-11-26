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
    // 3-stage approval audit trail (26 Nov 2026) - everything below is a snapshot at the time.
    project: { type: Schema.Types.ObjectId, ref: 'CommercialProject', default: null },
    action: { type: String, enum: ['Approved', 'Rejected', 'Reset'], default: null },
    approverName: { type: String, default: null },
    approverRole: { type: String, default: null },
    revisionNumber: { type: Number, default: null },
    // The engineering, BOQ and pricing of one Deal Engine revision live on the same document; the
    // calculation time + fingerprints identify exactly which calculation of it was decided on.
    calculatedAt: { type: Date, default: null },
    basis: { type: Schema.Types.Mixed, default: null },
    workflowBefore: { type: String, default: null },
    workflowAfter: { type: String, default: null },
    workflowVersion: { type: Number, default: null },
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
commercialApprovalSchema.index({ project: 1, createdAt: 1 });

// The approval history is append-only: no update or delete through the application (Mongoose
// queries). New decisions and resets are new records.
const immutable = function refuse(next) {
  next(new Error('Approval records are immutable - append a new record instead.'));
};
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete', 'findOneAndRemove']) {
  commercialApprovalSchema.pre(op, immutable);
}
commercialApprovalSchema.pre('save', function onlyNew(next) {
  if (!this.isNew) return next(new Error('Approval records are immutable - append a new record instead.'));
  return next();
});

module.exports = model('CommercialApproval', commercialApprovalSchema);
