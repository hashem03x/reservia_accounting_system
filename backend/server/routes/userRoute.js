const express = require('express');

const router = express.Router();

const authController = require('../controller/user/authController');

const { checkUserPermissions } = require('../middleware/hasPermission');

const {
  createUser,
  deleteUser,
  getUser,
  getUsers,
  updateUser,
  resizeImage,
  uploadUserImage,
  updateUserPassword,
  getLoggedUserData,
  updateLoggedUserPassword,
  updateLoggedUserData,
  deleteLoggedUser,
  assignRole,
  createOfflineCustomer,
  updateOfflineCustomer,
} = require('../controller/user/userController');

const {
  createUserValidator,
  getUserValidator,
  updateUserValidator,
  deleteUserValidator,
  updateUserPasswordValidator,
  updateLoggedUserValidator,
  updateLoggedUserValidatorPass,
} = require('../utils/validators/userValidator');

const { assignNewPermissionToUser, updatePermissionUser, deletePermissionUser, getPermissionUser } = require('../controller/user/userRoleController');
const { Resources, Actions } = require('../utils/appConstant');

router.use(authController.protect);

router.get('/getMe', getLoggedUserData);
router.put('/updateMe', updateLoggedUserValidator, updateLoggedUserData);

router.delete('/deleteMe', deleteLoggedUser);
router.put('/updateMyPassword', updateLoggedUserValidatorPass, updateLoggedUserPassword);

// Admin
// router.use(checkUserPermissions({resource:'users', action:['read']}));

router
  .route('/')
  .get(checkUserPermissions({ resource: Resources.users, action: Actions.read }), getUsers)
  .post(checkUserPermissions({ resource: Resources.users, action: Actions.create }), uploadUserImage, resizeImage, createUserValidator, createUser);

router.route('/offline').post(checkUserPermissions({ resource: Resources.users, action: Actions.create }), createOfflineCustomer);

router.route('/offline/:id').put(checkUserPermissions({ resource: Resources.users, action: Actions.update }), updateOfflineCustomer);

router
  .route('/:id')
  .get(checkUserPermissions({ resource: Resources.users, action: Actions.read }), getUserValidator, getUser)
  .put(checkUserPermissions({ resource: Resources.users, action: Actions.update }), uploadUserImage, resizeImage, updateUserValidator, updateUser)
  .delete(checkUserPermissions({ resource: Resources.users, action: Actions.delete }), deleteUserValidator, deleteUser);

router.put('/ChangePassword/:id', checkUserPermissions({ resource: Resources.users, action: Actions.update }), updateUserPasswordValidator, updateUserPassword);

router
  .route('/permssions/:id') // /api/v1/users/permssions/:userId
  .get(checkUserPermissions({ resource: Resources.permissions, action: Actions.read }), getPermissionUser)
  .post(checkUserPermissions({ resource: Resources.permissions, action: Actions.create }), assignNewPermissionToUser)
  .put(checkUserPermissions({ resource: Resources.permissions, action: Actions.update }), updatePermissionUser)
  .delete(checkUserPermissions({ resource: Resources.permissions, action: Actions.delete }), deletePermissionUser);

//
module.exports = router;
