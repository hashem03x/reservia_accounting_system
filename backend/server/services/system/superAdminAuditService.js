'use strict';

const SuperAdminOverrideLog = require('../../models/system/superAdminOverrideLogModel');

/**
 * Records one business-workflow restriction a Global Super Admin actually bypassed. Fire-and-
 * forget from the caller's point of view (awaited, but never allowed to block or fail the real
 * action it is logging - a missing audit row must never itself become the reason a legitimate
 * test action fails). Never logs on its own; every call site decides for itself whether an
 * override actually happened.
 */
async function logOverride({ actor, action, targetType, targetId, details = {} }) {
  try {
    await SuperAdminOverrideLog.create({
      actor: actor._id,
      actorName: actor.name || actor.email,
      actorEmail: actor.email,
      action,
      targetType,
      targetId,
      details,
      workflowRestrictionOverridden: true,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[SuperAdminAudit] failed to record override (action proceeds anyway):', err.message);
  }
}

module.exports = { logOverride };
