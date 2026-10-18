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

// check user permissions middleware permission {resource, action}
exports.checkUserPermissions = requiredPermission => (req, res, next) => {
  const { resource: requiredResource, action: requiredAction } = requiredPermission;
  const userPermissions = req.user.permissions;
  const userRole = req.user.role;

  // Central Business Portal: every route this guards is an ERP-internal action - active ERP
  // membership is required before even the role==='admin' bypass below applies, so revoking a
  // staff member's ERP access always takes effect immediately, including for ERP admins (see
  // utils/systemAccess.js#hasActiveErpMembership - the one shared implementation of "what counts
  // as active ERP access", also used by allowedTo and GET /me/systems).
  if (!hasActiveErpMembership(req.user)) {
    return next(new ApiError('You do not have access to the ERP system. Contact your administrator.', 403));
  }

  // check if user is admin
  const isAdmin = userRole === 'admin';
  if (isAdmin) return next();

  const hasPermission = userPermissions.some(permission => permission.resource === requiredResource && permission.actions.includes(requiredAction));

  // if allowed to user to access (resource , action)
  if (hasPermission) return next();

  // if not allowed access this resources denied it.
  return next(new ApiError('You are not allowed to access this resource', 403));
};
