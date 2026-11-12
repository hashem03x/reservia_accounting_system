const ApiError = require('../utils/apiError');

// Website Management access gate - mirrors middleware/crmAccess.js exactly in shape (active-
// membership check, then an authorization check, both via next(new ApiError(...))). Like CRM and
// Commercial, Website Management gates on its OWN named roles directly rather than the ERP's
// generic resource:action matrix (middleware/hasPermission.js) - the task's 7 named capabilities
// (view/edit/publish/media.manage/seo.manage/integrations.manage/settings.manage) map onto a
// fixed set per role, not a second stored permission matrix. See utils/systemsRegistry.js's
// WEBSITE entry for the three roles (admin/editor/viewer).
//
// `req.websiteRole`/`req.websiteCapabilities` below are ALWAYS read from the authenticated user's
// own `systemMemberships` array loaded from the database by authController.protect - never from
// the request body/query/headers.

const CAPABILITIES_BY_ROLE = {
  // navigation.manage / code.manage: the site structure and anything that EXECUTES on the public site
  // (custom code, custom HTML sections, tracking scripts) are administrator-only.
  admin: ['view', 'edit', 'publish', 'media.manage', 'seo.manage', 'integrations.manage', 'settings.manage', 'navigation.manage', 'code.manage', 'design.manage'],
  editor: ['view', 'edit', 'media.manage', 'seo.manage'],
  viewer: ['view'],
};

/** The user's own WEBSITE membership entry, or null if they have none. */
function websiteMembership(user) {
  if (!user || !Array.isArray(user.systemMemberships)) return null;
  return user.systemMemberships.find(m => m.system === 'WEBSITE') || null;
}

const hasActiveWebsiteMembership = user => !!websiteMembership(user)?.isActive;

/** Requires active WEBSITE membership; attaches req.websiteRole/req.websiteCapabilities for downstream checks. */
exports.requireWebsiteAccess = (req, res, next) => {
  const membership = websiteMembership(req.user);
  if (!membership?.isActive) {
    return next(new ApiError('You do not have access to the Website system. Contact your administrator.', 403));
  }
  req.websiteRole = membership.role;
  req.websiteCapabilities = CAPABILITIES_BY_ROLE[membership.role] || [];
  return next();
};

/** Requires every one of the given capabilities. Always run after requireWebsiteAccess. */
exports.requireWebsiteCapability = (...caps) => (req, res, next) => {
  if (!req.websiteCapabilities) {
    return next(new ApiError('You do not have access to the Website system. Contact your administrator.', 403));
  }
  const ok = caps.every(c => req.websiteCapabilities.includes(c));
  if (!ok) return next(new ApiError('You are not allowed to perform this action in Website Management.', 403));
  return next();
};

exports.CAPABILITIES_BY_ROLE = CAPABILITIES_BY_ROLE;
exports.websiteMembership = websiteMembership;
exports.hasActiveWebsiteMembership = hasActiveWebsiteMembership;
