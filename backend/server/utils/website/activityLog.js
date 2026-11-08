const WebsiteActivityLog = require('../../models/website/websiteActivityLogModel');

// Website Management - the one place every mutating controller records "who did what" (plan doc
// section 1). Mirrors controller/portal/platformAdminController.js#logAudit exactly: best-effort,
// fire-and-forget - an audit-log write failure must never block the real mutation it's recording.
function logWebsiteActivity({ actor, action, targetType, targetId = null, targetLabel = null, before = null, after = null }) {
  return WebsiteActivityLog.create({
    actor: actor._id,
    actorName: actor.name,
    actorEmail: actor.email,
    action,
    targetType,
    targetId,
    targetLabel,
    before,
    after,
  }).catch(err => console.error('[WebsiteActivityLog] failed to record entry:', err.message));
}

module.exports = { logWebsiteActivity };
