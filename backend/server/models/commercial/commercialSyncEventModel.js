const { Schema, model } = require('mongoose');

// Reservia - CRM <-> Commercial synchronization log (QA finding B5 / Developer Brief 6.1). One row
// per attempt to sync a lead event (proposal / won / lost / reopen) into Commercial - append-only, so
// "what was sent, when, by whom, did it work, and why not" is always answerable. The CURRENT status
// lives on the lead (CrmLead.commercial) and the project (CommercialProject.crmSync); this is the
// history behind them. No contact data is stored here - ids, identifiers and a short error only.
const commercialSyncEventSchema = new Schema(
  {
    lead: { type: Schema.Types.ObjectId, ref: 'CrmLead', required: true },
    leadRef: { type: String, default: null },
    project: { type: Schema.Types.ObjectId, ref: 'CommercialProject', default: null },
    event: { type: String, enum: ['proposal', 'won', 'lost', 'reopen'], required: true },
    status: { type: String, enum: ['synced', 'failed', 'skipped'], required: true },
    // true when this attempt found the work already done (a retry / duplicate trigger) - idempotency made visible
    replay: { type: Boolean, default: false },
    trigger: { type: String, enum: ['stage_change', 'retry', 'script'], default: 'stage_change' },
    identifiers: {
      dealNumber: { type: String, default: null },
      projectCode: { type: String, default: null },
      proposalNumber: { type: String, default: null },
      proposedErpProjectNumber: { type: String, default: null },
    },
    error: { type: String, maxlength: 500, default: null },
    actor: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

commercialSyncEventSchema.index({ lead: 1, createdAt: -1 });
commercialSyncEventSchema.index({ project: 1, createdAt: -1 });
commercialSyncEventSchema.index({ status: 1, createdAt: -1 });

module.exports = model('CommercialSyncEvent', commercialSyncEventSchema);
