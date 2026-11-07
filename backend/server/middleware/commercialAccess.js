const ApiError = require('../utils/apiError');

// Reservia Commercial access gate - mirrors middleware/crmAccess.js exactly (active-membership
// check, then a role check, both via next(new ApiError(...))). Gates directly on the Commercial
// system's own five named roles (md/commercial_director/sales/technical/member - see
// utils/systemsRegistry.js's COMMERCIAL entry) rather than the ERP's generic resource:action list,
// for the same reason CRM does: the approval workflow is defined in terms of these specific roles,
// not a resource:action matrix nothing asks for.
//
// `req.commercialRole` is ALWAYS read from the authenticated user's own `systemMemberships` array
// loaded from the database by authController.protect - never from the request body/query/headers.

/** The user's own Commercial membership entry, or null if they have none. */
function commercialMembership(user) {
  if (!user || !Array.isArray(user.systemMemberships)) return null;
  return user.systemMemberships.find(m => m.system === 'COMMERCIAL') || null;
}

const hasActiveCommercialMembership = user => !!commercialMembership(user)?.isActive;

/** Requires active Commercial membership; attaches `req.commercialRole` for downstream role checks. */
exports.requireCommercialAccess = (req, res, next) => {
  const membership = commercialMembership(req.user);
  if (!membership?.isActive) {
    return next(new ApiError('You do not have access to the Commercial system. Contact your administrator.', 403));
  }
  req.commercialRole = membership.role;
  return next();
};

/** Requires active Commercial membership AND one of the given Commercial roles. Always run after requireCommercialAccess. */
exports.requireCommercialRole = (...roles) => (req, res, next) => {
  if (!req.commercialRole) {
    return next(new ApiError('You do not have access to the Commercial system. Contact your administrator.', 403));
  }
  if (!roles.includes(req.commercialRole)) {
    return next(new ApiError('You are not allowed to perform this action in Commercial.', 403));
  }
  return next();
};

exports.commercialMembership = commercialMembership;
exports.hasActiveCommercialMembership = hasActiveCommercialMembership;
