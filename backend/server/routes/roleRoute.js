const express = require('express');

const router = express.Router();

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

router.route('/').get(getAllRoles).post(createRole);

router.route('/:id').get(getRole).put(updateRole).delete(deleteOne);

// router.route('/:id')    // /api/v1/users/:id
// .get(getPermissionRole)
// .post(assignNewPermissionToRole)
// .put(updatePermissionRole)
// .delete(deletePermissionRole);

module.exports = router;
