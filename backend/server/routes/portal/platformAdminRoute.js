const { Router } = require('express');
const authController = require('../../controller/user/authController');
const requirePlatformAdmin = require('../../middleware/requirePlatformAdmin');
const {
  listUsers,
  getUserDetail,
  createUser,
  updateUser,
  updateUserSystems,
  updatePlatformAdmin,
  resetUserPassword,
  listAuditLog,
} = require('../../controller/portal/platformAdminController');

const router = Router();

// `protect` only (no `allowedTo`/`checkUserPermissions`) - platform administration is a capability
// orthogonal to ERP's own role/permission system, gated purely by `requirePlatformAdmin` below
// (docs section "Administrative security" - "Prevent an ordinary ERP administrator from modifying
// platform-wide memberships unless that user has been explicitly granted the relevant central
// administration permission").
router.use(authController.protect, requirePlatformAdmin);

router.get('/audit-log', listAuditLog);

router.route('/users').get(listUsers).post(createUser);
router.route('/users/:id').get(getUserDetail).patch(updateUser);
router.put('/users/:id/systems', updateUserSystems);
router.patch('/users/:id/platform-admin', updatePlatformAdmin);
router.post('/users/:id/reset-password', resetUserPassword);

module.exports = router;
