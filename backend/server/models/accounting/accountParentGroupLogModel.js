const { Schema, model } = require('mongoose');

// Audit trail for Parent Account Groups (who created, edited, (de)activated or deleted a group, and
// when). A separate collection rather than a history array on the group itself, so a deletion is
// still on record after the group document is gone - same shape as PlatformAuditLog.
const accountParentGroupLogSchema = new Schema(
  {
    action: { type: String, required: true, enum: ['create', 'update', 'activate', 'deactivate', 'delete', 'migrate'] },
    group: { type: Schema.Types.ObjectId, ref: 'AccountParentGroup', required: true },
    groupNameEn: { type: String, required: true },
    actor: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    before: { type: Schema.Types.Mixed, default: null },
    after: { type: Schema.Types.Mixed, default: null },
    // How many accounts had their stored group names rewritten by this change (a rename).
    accountsUpdated: { type: Number, default: 0 },
  },
  { timestamps: true }
);

accountParentGroupLogSchema.index({ group: 1, createdAt: -1 });
accountParentGroupLogSchema.index({ createdAt: -1 });

module.exports = model('AccountParentGroupLog', accountParentGroupLogSchema);
