const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const asyncHandler = require('express-async-handler');
const { accessTokenCookieOptions, refreshTokenCookieOptions } = require('../../utils/cookieOptions');
const factory = require('../handlersFactory');
const ApiError = require('../../utils/apiError');
const { uploadSingleFile } = require('../../middleware/uploadImageMiddleware');
const User = require('../../models/userModel');
const RoleChangeLog = require('../../models/roleChangeLogModel');
const { createToken, createRefreshToken } = require('../../utils/createToken');
const safePromise = require('../../utils/safePromise');
const apiResponse = require('../../utils/apiResponse');
// Upload single image
exports.uploadUserImage = uploadSingleFile('profileImg');

// Image processing
exports.resizeImage = asyncHandler(async (req, res, next) => {
  const filename = `user-${uuidv4()}-${Date.now()}.png`;
  if (req.file) {
    await sharp(req.file.buffer)
      // .resize(600, 600)
      .toFormat('png')
      .png({ quality: +process.env.IMAGE_QUALITY })
      .toFile(`uploads/users/${filename}`);
    // Save image into db
    req.body.profileImg = filename;
  }
  next();
});

/**
 *  @description Get list of users
 *  @route       GET /api/v1/users
 *  @access      Private/Admin/
 */
exports.getUsers = factory.getAll(User);

/**
 *  @description Get User
 *  @route       GET /api/v1/Users/:id
 *  @access      Private/Admin
 */
exports.getUser = factory.getOne(User);

/**
 *  @description Create User
 *  @route       POST /api/v1/User
 *  @access      Private/Admin
 */
exports.createUser = asyncHandler(async (req, res, next) => {
  const { name, email, phone, password, role } = req.body;
  const user = await User.create({ name, email, phone, role, password: await bcrypt.hash(password, 5) });
  if (!user) return next(new ApiError('User not created', 500));
  await user.savePermissions();

  // Log role change if role is not "user"
  if (role && role !== 'user') {
    await RoleChangeLog.create({
      userId: user._id,
      userName: user.name,
      userEmail: user.email,
      previousRole: null,
      newRole: role,
      changedBy: req.user._id,
      changedByName: req.user.name,
      changedByEmail: req.user.email,
      action: 'create',
      ipAddress: req.ip || req.connection.remoteAddress,
    });
  }

  res.status(201).json(apiResponse('User created successfully', true, user));
});

/**
 *  @description Create offline customer
 *  @route       POST /api/v1/users/offline
 *  @access      Private/Admin
 */
exports.createOfflineCustomer = asyncHandler(async (req, res, next) => {
  // Check if customer exists with phone
  const existingCustomer = await User.findOne({ phone: req.body.phone });
  if (existingCustomer) {
    return next(new ApiError(`Customer with phone ${req.body.phone} already exists`, 400));
  }

  // Create offline customer
  const customer = await User.create({
    name: req.body.name,
    phone: req.body.phone,
    offlineAddress: req.body.offlineAddress,
    role: 'user',
    isOffline: true,
  });

  res.status(201).json({
    status: 'success',
    data: customer,
  });
});

/**
 *  @description Update offline customer
 *  @route       PATCH /api/v1/users/offline/:id
 *  @access      Private/Admin
 */
exports.updateOfflineCustomer = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  // Check if customer exists with phone
  const existingCustomer = await User.findOne({ phone: req.body.phone });
  if (existingCustomer && existingCustomer._id.toString() !== id) {
    return next(new ApiError(`Customer with phone ${req.body.phone} already exists`, 400));
  }

  // Update offline customer
  const customer = await User.findByIdAndUpdate(
    id,
    {
      $set: {
        name: req.body.name || existingCustomer.name,
        phone: req.body.phone || existingCustomer.phone,
        offlineAddress: req.body.offlineAddress || existingCustomer.offlineAddress,
      },
    },
    { new: true }
  );

  if (!customer) {
    return next(new ApiError('No customer found with that ID', 404));
  }

  res.json(new apiResponse('Offline customer updated successfully', true, customer));
});

/**
 *  @description Combine online and offline customers
 *  @route       POST /api/v1/users/combine
 *  @access      Private/Admin
 */
exports.combineCustomers = asyncHandler(async (req, res) => {
  const { onlineCustomerId, offlineCustomerId } = req.body;

  // Get both customers
  const onlineCustomer = await User.findById(onlineCustomerId);
  const offlineCustomer = await User.findById(offlineCustomerId);

  if (!onlineCustomer || !offlineCustomer) {
    return res.status(404).json({
      status: 'error',
      message: 'One or both customers not found',
    });
  }

  // Merge customer data
  onlineCustomer.mandoraAddress = offlineCustomer.mandoraAddress;
  if (!onlineCustomer.phone) onlineCustomer.phone = offlineCustomer.phone;

  // Save merged customer
  await onlineCustomer.save();

  // Mark offline customer as merged
  offlineCustomer.isMerged = true;
  offlineCustomer.mergedWith = onlineCustomer._id;
  await offlineCustomer.save();

  res.status(200).json({
    status: 'success',
    data: onlineCustomer,
  });
});

/**
 *  @description Search customers
 *  @route       GET /api/v1/users/search
 *  @access      Private/Admin
 */
exports.searchCustomers = asyncHandler(async (req, res) => {
  const { query } = req.query;

  const customers = await User.find({
    $or: [
      { name: { $regex: query, $options: 'i' } },
      { phone: { $regex: query, $options: 'i' } },
      { email: { $regex: query, $options: 'i' } },
      { mandoraAddress: { $regex: query, $options: 'i' } },
    ],
  });

  res.status(200).json({
    status: 'success',
    results: customers.length,
    data: customers,
  });
});

/**
 *  @description Update User
 *  @route       PUT /api/v1/User/:id
 *  @access      Private/Admin
 */
exports.updateUser = asyncHandler(async (req, res, next) => {
  // Get the current user to check for role changes
  const currentUser = await User.findById(req.params.id);

  if (!currentUser) {
    return next(new ApiError(`No user for this id ${req.params.id}`, 404));
  }

  const previousRole = currentUser.role;
  const newRole = req.body.role;

  const user = await User.findByIdAndUpdate(
    req.params.id,
    {
      name: req.body.name,
      slug: req.body.slug,
      phone: req.body.phone,
      email: req.body.email,
      profileImg: req.body.profileImg,
      role: req.body.role,
    },
    {
      new: true,
    }
  );

  if (!user) {
    return next(new ApiError(`No user for this id ${req.params.id}`, 404));
  }

  // Log role change if role has changed and new role is not "user"
  if (newRole && previousRole !== newRole) {
    await RoleChangeLog.create({
      userId: user._id,
      userName: user.name,
      userEmail: user.email,
      previousRole,
      newRole,
      changedBy: req.user._id,
      changedByName: req.user.name,
      changedByEmail: req.user.email,
      action: 'update',
      ipAddress: req.ip || req.connection.remoteAddress,
    });
  }

  res.status(200).json({ data: user });
});

/**
 *  @description Update User password
 *  @route       PUT /api/v1/user/:id
 *  @access      Private/Admin
 */
exports.updateUserPassword = asyncHandler(async (req, res, next) => {
  const user = await User.findByIdAndUpdate(
    req.params.id,
    {
      password: await bcrypt.hash(req.body.password, 5),
      passwordChangedAt: Date.now(),
    },
    { new: true }
  );

  if (!user) {
    return next(new ApiError(`No user for this id ${req.params.id}`, 404));
  }
  res.status(200).json({ data: user });
});

/**
 *  @description Delete User
 *  @route       DELETE /api/user/:id
 *  @access      Private/Admin
 */

// exports.deleteUser = factory.deleteOne(User);

exports.deleteUser = asyncHandler(async (req, res, next) => {
  const user = await User.findByIdAndUpdate(req.params.id, { $set: { isDeleted: true } }, { new: true });
  if (!user) return next(new ApiError(`No user for this id ${req.params.id}`, 404));
  res.status(200).json({ data: user });
});

/**
 *  @description Delete User
 *  @route       DELETE /api/user/:id
 *  @access      Private/Admin
 */
exports.assignRole = async (req, res, next) => {
  const userId = req.params.id;

  const [err, user] = await safePromise(() => User.findById(userId));

  if (err) return next(new ApiError(err.message, 5000));

  user.role = req.body.role;

  await user.save();

  res.status(200).json(apiResponse('addes role to user successfuly', true, user));
};

/**
 *  @description    Get logged user data
 *  @route          GET /api/users/getMe
 *  @access         Private/Protect
 */
exports.getLoggedUserData = asyncHandler(async (req, res, next) => {
  res.status(200).json({ data: req.user });
});

/**
 *  @description    Update logged user password
 *  @route          PUT /api/users/updateMyPassword
 *  @access         Private/Protect
 */
exports.updateLoggedUserPassword = asyncHandler(async (req, res, next) => {
  // 1- Update user password based on user payload (req.user._id)
  const user = await User.findByIdAndUpdate(
    req.user._id,
    {
      password: await bcrypt.hash(req.body.password, 5),
      passwordChangedAt: Date.now(),
    },
    { new: true }
  );
  const token = createToken(user._id);
  const refreshToken = createRefreshToken(user._id);

  res.cookie('access_token', token, accessTokenCookieOptions);
  res.cookie('refresh_token', refreshToken, refreshTokenCookieOptions);

  res.status(200).json({ data: user, token });
});

// updateAddress

/**
 *  @description    Update logged user data without(password, role)
 *  @route          PUT /api/users/updateMe
 *  @access         Private/Protect
 */
exports.updateLoggedUserData = asyncHandler(async (req, res, next) => {
  const user = await User.findByIdAndUpdate(
    req.user._id,
    {
      name: req.body.name,
      email: req.body.email,
      phone: req.body.phone,
    },
    { new: true }
  );

  res.status(200).json({ data: user });
});

/**
 *  @description    Deactivate logged user
 *  @route          Delete /api/users/deleteMe
 *  @access         Private/Protect
 */
exports.deleteLoggedUser = asyncHandler(async (req, res, next) => {
  await User.findOneAndUpdate(req.user._id, { active: false });

  res.status(204).json({ status: 'Success' });
});

/**
 *  @description    Get role change logs for a specific user
 *  @route          GET /api/v1/users/:id/role-logs
 *  @access         Private/Admin
 */
exports.getUserRoleLogs = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 10;
  const skip = (page - 1) * limit;

  const logs = await RoleChangeLog.find({ userId: id }).populate('changedBy', 'name email').sort({ createdAt: -1 }).skip(skip).limit(limit);

  const total = await RoleChangeLog.countDocuments({ userId: id });

  res.status(200).json({
    status: 'success',
    results: logs.length,
    totalPages: Math.ceil(total / limit),
    currentPage: page,
    data: logs,
  });
});

/**
 *  @description    Get all role change logs
 *  @route          GET /api/v1/users/role-logs
 *  @access         Private/Admin
 */
exports.getAllRoleLogs = asyncHandler(async (req, res, next) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const skip = (page - 1) * limit;

  // Build filter
  const filter = {};
  if (req.query.userId) filter.userId = req.query.userId;
  if (req.query.changedBy) filter.changedBy = req.query.changedBy;
  if (req.query.role) filter.newRole = req.query.role;
  if (req.query.action) filter.action = req.query.action;

  const logs = await RoleChangeLog.find(filter).populate('userId', 'name email phone').populate('changedBy', 'name email').sort({ createdAt: -1 }).skip(skip).limit(limit);

  const total = await RoleChangeLog.countDocuments(filter);

  res.status(200).json({
    status: 'success',
    results: logs.length,
    totalPages: Math.ceil(total / limit),
    currentPage: page,
    data: logs,
  });
});
