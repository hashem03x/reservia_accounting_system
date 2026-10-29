const ApiError = require('../utils/apiError');

// Reservia CRM access gate - mirrors middleware/hasPermission.js's ERP gate exactly in shape
// (active-membership check, then an authorization check, both via next(new ApiError(...))), but
// the authorization model itself is different on purpose: ERP permissions are a generic
// resource:action list (middleware/hasPermission.js#userHasPermission); the CRM brief instead
// defines behaviour directly in terms of its own four named roles (md/admin/sales/technical - see
// utils/systemsRegistry.js's CRM entry), so this gate gates on `role` directly rather than
// inventing a parallel resource:action matrix nothing in the brief asks for.
//
// "Never trust role names, user IDs, or permissions supplied by the browser" (the task's own
// instruction): `req.crmRole` below is ALWAYS read from the authenticated user's own
// `systemMemberships` array loaded from the database by authController.protect - never from the
// request body/query/headers.

/** The user's own CRM membership entry, or null if they have none. */
function crmMembership(user) {
  if (!user || !Array.isArray(user.systemMemberships)) return null;
  return user.systemMemberships.find(m => m.system === 'CRM') || null;
}

const hasActiveCrmMembership = user => !!crmMembership(user)?.isActive;

/** Requires active CRM membership; attaches `req.crmRole` for downstream role checks. */
exports.requireCrmAccess = (req, res, next) => {
  const membership = crmMembership(req.user);
  if (!membership?.isActive) {
    return next(new ApiError('You do not have access to the CRM system. Contact your administrator.', 403));
  }
  req.crmRole = membership.role;
  return next();
};

/** Requires active CRM membership AND one of the given CRM roles. Always run after requireCrmAccess. */
exports.requireCrmRole = (...roles) => (req, res, next) => {
  if (!req.crmRole) return next(new ApiError('You do not have access to the CRM system. Contact your administrator.', 403));
  if (!roles.includes(req.crmRole)) return next(new ApiError('You are not allowed to perform this action in the CRM.', 403));
  return next();
};

exports.crmMembership = crmMembership;
exports.hasActiveCrmMembership = hasActiveCrmMembership;
