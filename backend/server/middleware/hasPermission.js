const User = require('../models/userModel');
const ApiError = require('../utils/apiError');
const { hasActiveErpMembership } = require('../utils/systemAccess');

// async function hasPermission(roleId, resource, action) {
//     // Step 1: Populate user roles and permissions  can use it
//     /**
//      * \{
//      *   _id: 60f8f2e3d8d0e5b1e0a4c5b5,
//      *   name: 'admin',
//      *  permissions: [
//      *    {
//      *    resource: 'product',
//      *   actions: ['create', 'read', 'update', 'delete']
//      *   },
//      *  {
//      *   resource: 'user',
//      *  actions: ['read']
//      * }
//      * ]
//      * }
//      */
//     // step 1 get role by id from token
//     const userRole = await Role.findById(roleId).lean();  // get role by id from token []
//     if (!userRole) {
//          throw new ApiError('user not found', 401 );
//     }

//     //

//     // Step 2: Check each role for the required permission
//     const hasPermission = userRole.permissions.some(permission =>
//         permission.resource === resource && permission.actions.includes(action)
//     );

//     return hasPermission; // Permission not found in any of the user's roles
// }

// Pure "does this user have resource:action" check (role==='admin' bypasses everything, exactly
// like checkUserPermissions below) - extracted so a one-off, conditional permission check (e.g.
// Journal Entry General-entry creation, gated on resource 'journalEntries' action 'createGeneral'
// only when the request has no project - see journalEntryValidators.js#projectRequired) can reuse
// the SAME rule a route-level `checkUserPermissions(...)` middleware would apply, instead of a
// second, drift-prone reimplementation. Deliberately does NOT check ERP membership itself - that
// is the route's own `checkUserPermissions` gate's job, already run before any validator;  this
// helper is for an ADDITIONAL business rule layered on top of an already-authorized request.
function userHasPermission(user, resource, action) {
  if (user?.role === 'admin') return true;
  return (user?.permissions || []).some(permission => permission.resource === resource && permission.actions.includes(action));
}

// check user permissions middleware permission {resource, action}
exports.checkUserPermissions = requiredPermission => (req, res, next) => {
  const { resource: requiredResource, action: requiredAction } = requiredPermission;

  // Central Business Portal: every route this guards is an ERP-internal action - active ERP
  // membership is required before even the role==='admin' bypass below applies, so revoking a
  // staff member's ERP access always takes effect immediately, including for ERP admins (see
  // utils/systemAccess.js#hasActiveErpMembership - the one shared implementation of "what counts
  // as active ERP access", also used by allowedTo and GET /me/systems).
  if (!hasActiveErpMembership(req.user)) {
    return next(new ApiError('You do not have access to the ERP system. Contact your administrator.', 403));
  }

  if (userHasPermission(req.user, requiredResource, requiredAction)) return next();

  // if not allowed access this resources denied it.
  return next(new ApiError('You are not allowed to access this resource', 403));
};

// Same gate as checkUserPermissions, satisfied by ANY one of several resource:action pairs - for a
// read that more than one feature legitimately needs (e.g. the currency list is read by the
// Currency Manager AND by the Journal Entry form, whose users may hold only journalEntries:read).
exports.checkAnyUserPermission = requiredPermissions => (req, res, next) => {
  if (!hasActiveErpMembership(req.user)) {
    return next(new ApiError('You do not have access to the ERP system. Contact your administrator.', 403));
  }
  if (requiredPermissions.some(({ resource, action }) => userHasPermission(req.user, resource, action))) return next();
  return next(new ApiError('You are not allowed to access this resource', 403));
};

exports.userHasPermission = userHasPermission;
