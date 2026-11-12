const { Schema, model } = require('mongoose');

// Website Management - activity log for every mutating action in this module, mirroring
// models/platformAuditLogModel.js's shape exactly (actor/action-enum/target/before/after). Written
// via utils/website/activityLog.js#logWebsiteActivity, called fire-and-forget
// (.catch(console.error) - never blocks the real mutation it's recording) from every mutating
// controller, so "all website management actions are logged" holds by construction.
const websiteActivityLogSchema = new Schema(
  {
    actor: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    actorName: { type: String, required: true },
    actorEmail: { type: String, default: null },
    action: {
      type: String,
      required: true,
      enum: [
        'page.create',
        'page.update',
        'page.publish',
        'page.unpublish',
        'page.revert',
        'page.delete',
        'page.schedule',
        'page.archive',
        'page.restore',
        'page.reorder',
        'section.create',
        'section.update',
        'section.reorder',
        'section.duplicate',
        'section.delete',
        'media.upload',
        'media.update',
        'media.delete',
        'media.replace',
        'navigation.update',
        'settings.update',
        'integration.update',
        'customCode.create',
        'customCode.update',
        'customCode.delete',
        'deploy.preview',
        'deploy.publish',
        'preview.create',
        'visual.save',
        'visual.publish',
        'visual.restore',
        'visual.rollback',
        'code.commit',
        'code.revert',
        'code.branch',
        'code.pullRequest',
        'code.deploy',
      ],
    },
    targetType: {
      type: String,
      required: true,
      enum: ['WebsitePage', 'WebsiteSection', 'WebsiteMedia', 'WebsiteNavigation', 'WebsiteSettings', 'WebsiteIntegration', 'WebsiteCustomCode', 'WebsiteVisual', 'WebsiteCode'],
    },
    targetId: { type: Schema.Types.ObjectId, default: null },
    targetLabel: { type: String, default: null },
    before: { type: Schema.Types.Mixed, default: null },
    after: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

websiteActivityLogSchema.index({ createdAt: -1 });
websiteActivityLogSchema.index({ targetType: 1, targetId: 1, createdAt: -1 });

module.exports = model('WebsiteActivityLog', websiteActivityLogSchema);
