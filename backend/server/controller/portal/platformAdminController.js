const asyncHandler = require('express-async-handler');
const bcrypt = require('bcryptjs');
const User = require('../../models/userModel');
const PlatformAuditLog = require('../../models/platformAuditLogModel');
const ApiError = require('../../utils/apiError');
const apiResponse = require('../../utils/apiResponse');
const { forgotPassword } = require('../user/authController');
const { SYSTEMS, isValidSystemId, isValidRoleForSystem } = require('../../utils/systemsRegistry');

// Central Business Portal - platform-wide administration (docs section "Central System and Role
// Administration"). Every endpoint here is mounted behind `requirePlatformAdmin`
// (routes/portal/platformAdminRoute.js) - a capability deliberately distinct from the ERP's own
// `role: 'admin'`. Never exposes `password` (or any other sensitive field) - every query below
// explicitly `.select('-password ...')` rather than relying on a shape that happens not to
// include it.

const SAFE_FIELDS = '-password -passwordResetCode -passwordResetCodeExpires';

function logAudit({ actor, action, targetUser, before, after }) {
  // Best-effort - an audit-log write failure must never block the real mutation it's recording.
  return PlatformAuditLog.create({
    actor: actor._id,
    actorName: actor.name,
    actorEmail: actor.email,
    action,
    targetUser: targetUser._id,
    targetUserName: targetUser.name,
    targetUserEmail: targetUser.email,
    before,
    after,
  }).catch(err => console.error('[PlatformAuditLog] failed to record entry:', err.message));
}

/**
 * @description  List/search/paginate users with their system memberships.
 * @route        GET /api/v1/admin/platform/users
 * @access       Private/PlatformAdmin
 */
exports.listUsers = asyncHandler(async (req, res) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.max(parseInt(req.query.limit, 10) || 20, 1);
  const skip = (page - 1) * limit;

  const filter = {};
  const keyword = (req.query.keyword || '').trim();
  if (keyword) {
    filter.$or = [{ name: { $regex: keyword, $options: 'i' } }, { email: { $regex: keyword, $options: 'i' } }, { phone: { $regex: keyword, $options: 'i' } }];
  }
  if (req.query.system && isValidSystemId(req.query.system)) {
    filter['systemMemberships.system'] = req.query.system;
    filter['systemMemberships.isActive'] = true;
  }
  if (req.query.platformAdmin === 'true') filter.platformAdmin = true;

  const [users, total] = await Promise.all([
    User.find(filter).select(SAFE_FIELDS).sort({ createdAt: -1 }).skip(skip).limit(limit),
    User.countDocuments(filter),
  ]);

  res.status(200).json(
    apiResponse('OK', true, users, {
      page,
      limit,
      total,
      totalPages: Math.max(Math.ceil(total / limit), 1),
    })
  );
});

/**
 * @description  Get one user's full detail, including system memberships.
 * @route        GET /api/v1/admin/platform/users/:id
 * @access       Private/PlatformAdmin
 */
exports.getUserDetail = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.params.id).select(SAFE_FIELDS);
  if (!user) return next(new ApiError('No user found with that id.', 404));
  res.status(200).json(apiResponse('OK', true, user));
});

/**
 * @description  Create a user. Delegates to the exact same creation shape the existing
 *               POST /api/v1/users endpoint uses (User.create + savePermissions), so numbering,
 *               validation and hooks stay identical - never a second creation code path. System
 *               memberships are never auto-granted on creation - that's a deliberate, separate,
 *               auditable step via PUT /:id/systems.
 * @route        POST /api/v1/admin/platform/users
 * @access       Private/PlatformAdmin
 */
exports.createUser = asyncHandler(async (req, res, next) => {
  const { name, email, phone, password, role } = req.body;
  if (!name || !email || !password) return next(new ApiError('name, email and password are required.', 400));

  const existing = await User.findOne({ $or: [{ email }, ...(phone ? [{ phone }] : [])] });
  if (existing) return next(new ApiError('A user with this email or phone already exists.', 400));

  const user = await User.create({ name, email, phone, role: role || 'user', password: await bcrypt.hash(password, 5) });
  await user.savePermissions();
  await user.save();

  await logAudit({ actor: req.user, action: 'user.create', targetUser: user, before: null, after: { name, email, phone, role: user.role } });

  const safeUser = await User.findById(user._id).select(SAFE_FIELDS);
  res.status(201).json(apiResponse('User created successfully.', true, safeUser));
});

/**
 * @description  Update a user's basic details or active status. Never password or role directly
 *               - role (for ERP) is changed via PUT /:id/systems, since the stored ERP membership
 *               role mirrors the User.role field exactly (see utils/systemsRegistry.js).
 * @route        PATCH /api/v1/admin/platform/users/:id
 * @access       Private/PlatformAdmin
 */
exports.updateUser = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.params.id);
  if (!user) return next(new ApiError('No user found with that id.', 404));

  const before = { name: user.name, isActive: user.isActive };
  if (req.body.name !== undefined) user.name = req.body.name;
  if (req.body.isActive !== undefined) user.isActive = !!req.body.isActive;
  await user.save();

  await logAudit({ actor: req.user, action: 'user.update', targetUser: user, before, after: { name: user.name, isActive: user.isActive } });

  const safeUser = await User.findById(user._id).select(SAFE_FIELDS);
  res.status(200).json(apiResponse('User updated successfully.', true, safeUser));
});

/**
 * @description  Replace a user's system memberships wholesale. Every {system, role} pair is
 *               validated against the one shared registry (utils/systemsRegistry.js) - an
 *               unknown system id or a role not valid for that system is rejected outright, never
 *               silently stored.
 * @route        PUT /api/v1/admin/platform/users/:id/systems
 * @access       Private/PlatformAdmin
 */
exports.updateUserSystems = asyncHandler(async (req, res, next) => {
  const { systemMemberships } = req.body;
  if (!Array.isArray(systemMemberships)) return next(new ApiError('systemMemberships must be an array.', 400));

  const seen = new Set();
  for (const entry of systemMemberships) {
    if (!entry || typeof entry !== 'object') return next(new ApiError('Each system membership must be an object.', 400));
    const { system, role, isActive } = entry;
    if (!isValidSystemId(system)) return next(new ApiError(`"${system}" is not a valid system id.`, 400));
    if (seen.has(system)) return next(new ApiError(`Duplicate system membership entry for "${system}".`, 400));
    seen.add(system);
    if (!isValidRoleForSystem(system, role)) {
      return next(new ApiError(`"${role}" is not a valid role for ${system}. Valid roles: ${SYSTEMS[system].roles.join(', ')}.`, 400));
    }
    if (isActive !== undefined && typeof isActive !== 'boolean') return next(new ApiError('isActive must be a boolean.', 400));
  }

  const user = await User.findById(req.params.id);
  if (!user) return next(new ApiError('No user found with that id.', 404));

  const before = user.systemMemberships;
  user.systemMemberships = systemMemberships.map(({ system, role, isActive }) => ({ system, role, isActive: isActive !== false }));
  await user.save();

  await logAudit({ actor: req.user, action: 'user.systems.update', targetUser: user, before, after: user.systemMemberships });

  const safeUser = await User.findById(user._id).select(SAFE_FIELDS);
  res.status(200).json(apiResponse('System memberships updated successfully.', true, safeUser));
});

/**
 * @description  Grant or revoke platform-wide administrator access. A separate, explicit,
 *               auditable action from the systems PUT above (docs section "Central System and
 *               Role Administration" - "Do not allow an administrator to accidentally lock the
 *               system out of all platform administrators").
 * @route        PATCH /api/v1/admin/platform/users/:id/platform-admin
 * @access       Private/PlatformAdmin
 */
exports.updatePlatformAdmin = asyncHandler(async (req, res, next) => {
  const { platformAdmin } = req.body;
  if (typeof platformAdmin !== 'boolean') return next(new ApiError('platformAdmin must be a boolean.', 400));

  const user = await User.findById(req.params.id);
  if (!user) return next(new ApiError('No user found with that id.', 404));

  if (user.platformAdmin && !platformAdmin) {
    // Revoking - never let the LAST remaining platform admin be removed.
    const remainingOtherAdmins = await User.countDocuments({ _id: { $ne: user._id }, platformAdmin: true });
    if (remainingOtherAdmins === 0) {
      return next(new ApiError('Refusing to revoke the last remaining platform administrator.', 400));
    }
  }

  const before = user.platformAdmin;
  user.platformAdmin = platformAdmin;
  await user.save();

  await logAudit({ actor: req.user, action: 'user.platformAdmin.update', targetUser: user, before, after: platformAdmin });

  const safeUser = await User.findById(user._id).select(SAFE_FIELDS);
  res.status(200).json(apiResponse('Platform admin access updated successfully.', true, safeUser));
});

/**
 * @description  Initiate a password reset for a target user - reuses the existing
 *               forgotPassword flow verbatim (same reset-code/email mechanism a user would
 *               trigger themself), never a second reset implementation.
 * @route        POST /api/v1/admin/platform/users/:id/reset-password
 * @access       Private/PlatformAdmin
 */
exports.resetUserPassword = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.params.id);
  if (!user) return next(new ApiError('No user found with that id.', 404));
  if (!user.email) return next(new ApiError('This user has no email on file to send a reset code to.', 400));

  await logAudit({ actor: req.user, action: 'user.password.reset', targetUser: user, before: null, after: null });

  req.body.email = user.email;
  return forgotPassword(req, res, next);
});

/**
 * @description  List platform-administration audit history.
 * @route        GET /api/v1/admin/platform/audit-log
 * @access       Private/PlatformAdmin
 */
exports.listAuditLog = asyncHandler(async (req, res) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.max(parseInt(req.query.limit, 10) || 20, 1);
  const skip = (page - 1) * limit;

  const filter = {};
  if (req.query.targetUser) filter.targetUser = req.query.targetUser;

  const [entries, total] = await Promise.all([
    PlatformAuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    PlatformAuditLog.countDocuments(filter),
  ]);

  res.status(200).json(
    apiResponse('OK', true, entries, {
      page,
      limit,
      total,
      totalPages: Math.max(Math.ceil(total / limit), 1),
    })
  );
});
