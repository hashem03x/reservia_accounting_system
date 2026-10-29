const { Schema, model } = require('mongoose');
const { STAGES } = require('../../utils/crm/constants');

// Reservia CRM - an immutable audit record of one stage change (Developer Brief section 7: every
// transition must be attributable and reconstructable - who moved it, when, from/to which stage,
// and why if it was a Lost or a backward move). Never edited or deleted after creation; a
// correction is a NEW stage change, never a rewrite of history - mirrors this codebase's existing
// append-only convention for accounting ledgers (journal entries are reversed, never mutated).
const stageHistorySchema = new Schema(
  {
    lead: { type: Schema.Types.ObjectId, ref: 'CrmLead', required: true },
    from: { type: String, enum: [...STAGES, null], default: null },
    to: { type: String, enum: STAGES, required: true },
    changedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    // Only set on a transition to 'lost'.
    lostReason: { type: String, default: null },
    // Only set on a transition to 'won', captured at the moment of winning so a later edit to the
    // lead's own `valueEgp` never rewrites what the deal was actually won at.
    valueEgpAtChange: { type: Number, default: null },
    mdApproved: { type: Boolean, default: false },
  },
  { timestamps: true }
);

stageHistorySchema.index({ lead: 1, createdAt: 1 });

stageHistorySchema.pre(/^find/, function (next) {
  this.populate({ path: 'changedBy', select: 'name' });
  next();
});

module.exports = model('CrmStageHistory', stageHistorySchema);
