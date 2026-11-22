const mongoose = require('mongoose');

// Feature 5 - every business-workflow restriction a Global Super Admin actually bypassed while
// testing (CRM stage transitions reuse the EXISTING MD-override mechanism and its own audit trail
// - leadModel.js's stageHistory - so they are not duplicated here; this model is specifically for
// overrides that have no pre-existing audit path of their own, starting with the Deal Engine
// approval-role check). Deliberately separate from PlatformAuditLog (platform-admin user/
// membership management - a genuinely different concern, see that model's own header comment) and
// from RoleChangeLog (ERP role changes only).
const superAdminOverrideLogSchema = new mongoose.Schema(
  {
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    actorName: { type: String, required: true },
    actorEmail: { type: String },
    action: {
      type: String,
      required: true,
      enum: ['commercial.approval.role_override', 'commercial.approval.segregation_of_duties_override', 'crm.stage.super_admin_only_override'],
    },
    targetType: { type: String, required: true }, // e.g. 'CommercialRevision'
    targetId: { type: mongoose.Schema.Types.ObjectId, required: true },
    // What was actually bypassed, e.g. { stage: 'STAGE1', requiredRole: 'sales or technical', actingAs: 'md' }.
    details: { type: mongoose.Schema.Types.Mixed, default: {} },
    workflowRestrictionOverridden: { type: Boolean, required: true, default: true },
  },
  { timestamps: true }
);

superAdminOverrideLogSchema.index({ createdAt: -1 });
superAdminOverrideLogSchema.index({ targetType: 1, targetId: 1 });

module.exports = mongoose.model('SuperAdminOverrideLog', superAdminOverrideLogSchema);
