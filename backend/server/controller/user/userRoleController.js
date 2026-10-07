const Role = require('../../models/userRoleModel');
const User = require('../../models/userModel');

const ApiError = require('../../utils/apiError');
const apiResponse = require('../../utils/apiResponse');
const safePromise = require('../../utils/safePromise');

const factoryHandler = require('../handlersFactory');

/**
 *  @description  create role
 *  @route       Post /api/v1/role
 *  @access      Private/Admin/
 */
exports.createRole = factoryHandler.createOne(Role);

/**
 *  @description  get lists of  roles
 *  @route       GET /api/v1/role
 *  @access      Private/Admin/
 */
exports.getAllRoles = factoryHandler.getAll(Role);

/**
 *  @description  get role by id
 *  @route       GET /api/v1/role/:id
 *  @access      Private/Admin/
 */
exports.getRole = factoryHandler.getOne(Role);

/**
 *  @description  update role
 *  @route       update /api/v1/role/:id
 *  @access      Private/Admin/
 */
exports.updateRole = factoryHandler.updateOne(Role);
/**
 *  @description  delete role
 *  @route       delete /api/v1/role/:id
 *  @access      Private/Admin/
 */
exports.deleteOne = factoryHandler.deleteOne(Role);

/**
 *  @description  assign new permsiion to sepecify role
 *  @route       delete /api/v1/permission/:id
 *  @access      Private/Admin/
 */

exports.getPermissionRole = async (req, res, next) => {
  const roleId = req.params.id;

  const [errRole, resRole] = await safePromise(() => Role.findById(roleId));

  if (errRole) return next(new ApiError(errRole.messsage, 500));

  res.status(200).json(apiResponse('Permission get to role successfully', true, resRole.permissions));
};

exports.getPermissionUser = async (req, res, next) => {
  const UserId = req.params.id;

  const [errUser, resUser] = await safePromise(() => User.findById(UserId));
  // check if exist User or  )

  if (errUser) return next(new ApiError(errUser.messsage, 500));

  res.status(200).json(apiResponse('Permission get to role successfully', true, resUser.permissions));
};

exports.assignNewPermissionToUser = async (req, res, next) => {
  const userId = req.params.id;
  let permissions = req.body;
  try {
    // Ensure permissions is always an array
    permissions = Array.isArray(permissions) ? permissions : [permissions];

    if (!permissions.length) {
      return next(new ApiError('Permissions not found', 404));
    }

    // Update user's permissions in the database
    const [errUser, user] = await safePromise(() => User.findByIdAndUpdate(userId, { $set: { permissions } }, { new: true }));

    // console.log(user);

    if (errUser) {
      return next(new ApiError(errUser.message, 500));
    }

    if (!user) {
      return next(new ApiError('User not found', 404));
    }

    // console.log(user.permissions);

    res.status(200).json(apiResponse('Permissions added to user successfully', true, user));
  } catch (error) {
    next(new ApiError(error.message, 500));
  }
};

/**
 *  @description  update  permsiion to sepecify User
 *  @route       delete /api/v1/permission/:id
 *  @access      Private/Admin/
 */
exports.updatePermissionUser = async (req, res, next) => {
  const UserId = req.params.id;

  const { action, resource, permissionId } = req.body;

  const [errUser, resUser] = await safePromise(() => User.findById(UserId));
  // check if exist User or  )

  if (errUser) return next(new ApiError(errUser.messsage, 500));

  // find permission by id

  // from client take permissionId
  // const permissionId = req.body.permissionId;

  // getPermission
  const permission = resUser.permissions.find(permission => permission._id == permissionId);

  if (!permission) return next(new ApiError('Permission not found', 404));

  // update permission
  if (resource) permission.resource = resource;
  if (action) permission.actions = action;

  await resUser.save();

  res.status(200).json(apiResponse('Permission updated successfully', true, resUser.permissions));
};

/**
 *  @description  delete  permsiion to sepecify User
 *  @route       delete /api/v1/permission/:id
 *  @access      Private/Admin/
 */

exports.deletePermissionUser = async (req, res, next) => {
  const UserId = req.params.id;

  const [errUser, resUser] = await safePromise(() => User.findById(UserId));
  // check if exist User or  )

  if (errUser) return next(new ApiError(errUser.messsage, 500));

  // find permission by id

  // from client take permissionId
  const permissionId = req.body.permissionId;

  // getPermission
  const permission = resUser.permissions.find(permission => permission._id == permissionId);

  if (!permission) return next(new ApiError('Permission not found', 404));

  // delete permission
  resUser.permissions = resUser.permissions.filter(permission => permission._id != permissionId);

  await resUser.save();

  res.status(200).json(apiResponse('Permission deleted successfully', true, resUser.permissions));
};
