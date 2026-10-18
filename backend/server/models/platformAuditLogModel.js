const mongoose = require('mongoose');

// Central Business Portal - minimal audit trail for platform-wide administration actions
// (grant/revoke platformAdmin, replace a user's systemMemberships, activate/deactivate, create).
// Deliberately separate from the pre-existing `RoleChangeLog` (models/roleChangeLogModel.js),
// which only ever records ERP's own `role` field changes - a genuinely different, narrower
// concern than platform-wide system access, which this model exists to cover.
const platformAuditLogSchema = new mongoose.Schema(
  {
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    actorName: { type: String, required: true },
    actorEmail: { type: String },
    action: {
      type: String,
      required: true,
      enum: ['user.create', 'user.update', 'user.systems.update', 'user.platformAdmin.update', 'user.password.reset'],
    },
    targetUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    targetUserName: { type: String },
    targetUserEmail: { type: String },
    before: { type: mongoose.Schema.Types.Mixed },
    after: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

platformAuditLogSchema.index({ createdAt: -1 });
platformAuditLogSchema.index({ targetUser: 1, createdAt: -1 });

module.exports = mongoose.model('PlatformAuditLog', platformAuditLogSchema);
