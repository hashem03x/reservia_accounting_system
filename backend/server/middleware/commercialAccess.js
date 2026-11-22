const ApiError = require('../utils/apiError');
const { isGlobalSuperAdmin } = require('../utils/systemAccess');

// Reservia Commercial access gate - mirrors middleware/crmAccess.js exactly (active-membership
// check, then a role check, both via next(new ApiError(...))). Gates directly on the Commercial
// system's own six named roles (md/commercial_director/sales/technical/procurement/member - see
// utils/systemsRegistry.js's COMMERCIAL entry) rather than the ERP's generic resource:action list,
// for the same reason CRM does: the approval workflow is defined in terms of these specific roles,
// not a resource:action matrix nothing asks for.
//
// `req.commercialRole`/`req.commercialRoles` are ALWAYS read from the authenticated user's own
// `systemMemberships` array loaded from the database by authController.protect - never from the
// request body/query/headers.
//
// Deal Engine Changes Required Rev 02, R13: "a user with two roles gets the wider right for each
// field". `systemMemberships` has no uniqueness constraint on `system`, so a user CAN hold two
// active COMMERCIAL memberships with different roles - `commercialRoles` below collects ALL of
// them (not just the first), so utils/commercial/dealEnginePermissions.js can resolve the widest
// access per field. `req.commercialRole` (singular) stays the first one, unchanged, for the
// pre-existing requireCommercialRole() call sites that only ever needed one role to check against.

/** Every active Commercial membership the user holds, or [] if none. */
function commercialMemberships(user) {
  if (!user || !Array.isArray(user.systemMemberships)) return [];
  return user.systemMemberships.filter(m => m.system === 'COMMERCIAL' && m.isActive);
}

/** The user's FIRST Commercial membership entry (active or not), or null - back-compat helper. */
function commercialMembership(user) {
  if (!user || !Array.isArray(user.systemMemberships)) return null;
  return user.systemMemberships.find(m => m.system === 'COMMERCIAL') || null;
}

const hasActiveCommercialMembership = user => commercialMemberships(user).length > 0;

/** Requires active Commercial membership; attaches req.commercialRole(s) for downstream role/permission checks. */
exports.requireCommercialAccess = (req, res, next) => {
  if (isGlobalSuperAdmin(req.user)) {
    req.commercialRoles = ['md']; // the system-owning role (utils/systemsRegistry.js#SYSTEM_OWNER_ROLES)
    req.commercialRole = 'md';
    return next();
  }
  const memberships = commercialMemberships(req.user);
  if (!memberships.length) {
    return next(new ApiError('You do not have access to the Deal Engine. Contact your administrator.', 403));
  }
  req.commercialRoles = memberships.map(m => m.role);
  req.commercialRole = req.commercialRoles[0];
  return next();
};

/** Requires active Commercial membership AND one of the given Commercial roles. Always run after requireCommercialAccess. */
exports.requireCommercialRole = (...roles) => (req, res, next) => {
  if (isGlobalSuperAdmin(req.user)) return next();
  if (!req.commercialRoles?.length) {
    return next(new ApiError('You do not have access to the Deal Engine. Contact your administrator.', 403));
  }
  if (!req.commercialRoles.some(r => roles.includes(r))) {
    return next(new ApiError('You are not allowed to perform this action in the Deal Engine.', 403));
  }
  return next();
};

exports.commercialMembership = commercialMembership;
exports.commercialMemberships = commercialMemberships;
exports.hasActiveCommercialMembership = hasActiveCommercialMembership;
