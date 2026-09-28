const User = require('../models/userModel');
const ApiError = require('../utils/apiError');

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

  // check if user is admin
  const isAdmin = userRole === 'admin';
  if (isAdmin) return next();

  const hasPermission = userPermissions.some(permission => permission.resource === requiredResource && permission.actions.includes(requiredAction));

  // if allowed to user to access (resource , action)
  if (hasPermission) return next();

  // if not allowed access this resources denied it.
  return next(new ApiError('You are not allowed to access this resource', 403));
};
