const express = require('express');

const router = express.Router();

const authController = require('../controller/user/authController');
const { checkUserPermissions } = require('../middleware/hasPermission');
const { Resources, Actions } = require('../utils/appConstant');

const {
  createRole,
  getAllRoles,
  getRole,
  updateRole,
  deleteOne,
  // getPermissionRole,
  // assignNewPermissionToRole,
  // updatePermissionRole,
  // deletePermissionRole
} = require('../controller/user/userRoleController');

// Was mounted with no auth at all - any unauthenticated caller could create/edit/delete a Role
// document. Mirrors routes/userRoute.js's own protect() + checkUserPermissions(Resources.roles)
// pattern used everywhere else admin-level resources are guarded.
router.use(authController.protect);

router
  .route('/')
  .get(checkUserPermissions({ resource: Resources.roles, action: Actions.read }), getAllRoles)
  .post(checkUserPermissions({ resource: Resources.roles, action: Actions.create }), createRole);

router
  .route('/:id')
  .get(checkUserPermissions({ resource: Resources.roles, action: Actions.read }), getRole)
  .put(checkUserPermissions({ resource: Resources.roles, action: Actions.update }), updateRole)
  .delete(checkUserPermissions({ resource: Resources.roles, action: Actions.delete }), deleteOne);

// router.route('/:id')    // /api/v1/users/:id
// .get(getPermissionRole)
// .post(assignNewPermissionToRole)
// .put(updatePermissionRole)
// .delete(deletePermissionRole);

module.exports = router;
