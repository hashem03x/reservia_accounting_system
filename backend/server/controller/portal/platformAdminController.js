const asyncHandler = require('express-async-handler');
const User = require('../../models/userModel');
const PlatformAuditLog = require('../../models/platformAuditLogModel');
const ApiError = require('../../utils/apiError');
const apiResponse = require('../../utils/apiResponse');
const { generateStrongPassword } = require('../../utils/generatePassword');
const { SYSTEMS, isValidSystemId, isValidRoleForSystem, SYSTEM_OWNER_ROLES } = require('../../utils/systemsRegistry');

// Central Business Portal - platform-wide administration (docs section "Central System and Role
// Administration"). Every endpoint here is mounted behind `requirePlatformAdmin`
// (routes/portal/platformAdminRoute.js) - a capability deliberately distinct from the ERP's own
// `role: 'admin'`. Never exposes `password` (or any other sensitive field) - every query below
// explicitly `.select('-password ...')` rather than relying on a shape that happens not to
// include it.

const SAFE_FIELDS = '-password -passwordResetCode -passwordResetCodeExpires';

// Roles that only ever have to exist somewhere for the system to stay fully usable (MD-only
// targets/spend/archive/stage override/integration keys in CRM; MD final sign-off in Commercial).
// Defined once in the registry (also used by scripts/restoreSystemAccess.js).
const SOLE_AUTHORITY_ROLES = SYSTEM_OWNER_ROLES;

/**
 * @description  The systems registry (ids, names, implemented flag, valid roles) - so the admin UI
 *               offers each system's REAL roles instead of a hand-copied list that can drift (the
 *               drift that caused the 9 Nov 2026 MD access loss - see Change Request 2, item 0).
 * @route        GET /api/v1/admin/platform/systems
 * @access       Private/PlatformAdmin
 */
exports.listSystems = asyncHandler(async (req, res) => {
  res.status(200).json(apiResponse('OK', true, Object.values(SYSTEMS)));
});

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

  // Go-live Developer Pack F26/section 14: "Keep customers out of User Management." role:'user'
  // alone is NOT a safe "this is a customer" test - it is also the ERP's "no elevated ERP role"
  // value for a real staff member whose ERP access is intentionally None (createUser's own
  // comment above). What genuinely distinguishes a pure customer is that they NEVER hold a
  // platform-admin flag or a membership in any OTHER system either - a lead that reached Proposal
  // Sent (services/customer/sharedCustomerService.js#findOrCreateCustomer) gets role:'user' and
  // nothing else, ever. So: show a role:'user' account only if it is platformAdmin, or holds at
  // least one active system membership (any system) - exactly the two ways a real staff member
  // becomes reachable at all. A brand-new staff login not yet granted its first membership is the
  // one edge case this still misses, same window createUser's own doc already describes.
  // $and, not two separate $or assignments - a plain second `filter.$or = ...` would silently
  // overwrite this entity filter the moment a keyword search was also in play.
  const and = [{ $or: [{ role: { $ne: 'user' } }, { platformAdmin: true }, { systemMemberships: { $elemMatch: { isActive: true } } }] }];
  const keyword = (req.query.keyword || '').trim();
  if (keyword) {
    and.push({ $or: [{ name: { $regex: keyword, $options: 'i' } }, { email: { $regex: keyword, $options: 'i' } }, { phone: { $regex: keyword, $options: 'i' } }] });
  }
  const filter = { $and: and };
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
  const { name, email, password, role } = req.body;
  // Pre-launch audit finding: phone is optional here (unlike the ERP's own createUser, whose
  // validator requires it) but User.phone is a `sparse: true` unique index - sparse only skips a
  // document where the field is truly ABSENT, not one where it's present-but-"". Passing through
  // an empty string from the create form stored a real "" value, so the SECOND user created with
  // no phone hit a raw E11000 duplicate-key crash (reproduced live against production while
  // testing this feature). Coerced to undefined so the field is genuinely absent for every
  // phone-less user, exactly like the sparse index already assumes.
  const phone = req.body.phone || undefined;
  if (!name || !email || !password) return next(new ApiError('name, email and password are required.', 400));
  // NOTE: role:'user' is NOT exclusively "customer" in this schema - it is also the ERP's own
  // "no elevated ERP role" default for a staff member whose ERP access is intentionally None
  // (go-live Developer Pack section 5.2, e.g. the Technical Engineer). A real, tested flow creates
  // exactly such a login here, with CRM/HR/Commercial access granted afterward via PUT
  // /:id/systems and no ERP role at all - see test/portal/userCreationLogin.test.js. Rejecting
  // role:'user' here would break that legitimate case, so this endpoint cannot reliably refuse
  // "customers" by role alone; see listUsers below for how display-side filtering is actually done.

  const existing = await User.findOne({ $or: [{ email }, ...(phone ? [{ phone }] : [])] });
  if (existing) return next(new ApiError('A user with this email or phone already exists.', 400));

  // Pre-launch audit finding: do NOT pre-hash here. userModel.js's own pre('save') hook already
  // hashes `password` whenever it's modified - pre-hashing here too meant admin-created users got
  // a bcrypt hash OF a bcrypt hash, and could never log in (bcrypt.compare in authController.js
  // only ever checks against ONE round of hashing). Verified by reproducing it against a throwaway
  // local DB before this fix, and again after to confirm login now succeeds. See the same fix in
  // controller/user/userController.js#createUser, authController.js#resetPassword and
  // scripts/createAdminUser.js - every other `.create()`/`.save()` path had the identical bug.
  const user = await User.create({ name, email, phone, role: role || 'user', password });
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
  // NOTE: role:'user' alone cannot distinguish "a customer" from "a staff member with no elevated
  // ERP role" in this schema (see createUser's own comment above) - granting a CRM/HR/Commercial/
  // Website membership to a role:'user' account is the normal, tested way such a staff member
  // gets their first access. No guard here can be based on `role` without breaking that flow.

  const next_ = systemMemberships.map(({ system, role, isActive }) => ({ system, role, isActive: isActive !== false }));

  // Change Request 2, item 0 - lock-out protection. Removing (or deactivating) the LAST active
  // holder of a system's sole-authority role would make that system's MD-only functions
  // unreachable for everyone - exactly how the MD lost CRM/Commercial on 9 Nov 2026. Same
  // principle as the "never revoke the last platform admin" guard below.
  for (const [system, role] of Object.entries(SOLE_AUTHORITY_ROLES)) {
    const holds = list => list.some(m => m.system === system && m.role === role && m.isActive !== false);
    if (holds(user.systemMemberships) && !holds(next_)) {
      // eslint-disable-next-line no-await-in-loop
      const others = await User.countDocuments({ _id: { $ne: user._id }, systemMemberships: { $elemMatch: { system, role, isActive: true } } });
      if (others === 0) {
        return next(
          new ApiError(
            `Refusing to remove the last active ${SYSTEMS[system].name} "${role}" membership - nobody would be left who can use ${SYSTEMS[system].name}'s MD-only functions. Grant "${role}" to another user first.`,
            400
          )
        );
      }
    }
  }

  const before = user.systemMemberships;
  user.systemMemberships = next_;
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
 * @description  Directly sets a new password for a target user - no email involved (pre-launch
 *               audit: SMTP is not configured in production, so the former email-code flow this
 *               replaced could never actually be delivered). Pass `newPassword` to set a specific
 *               value (>= 6 characters, same minimum as every other password field - userValidator.js),
 *               or omit it to have the server generate a strong random one, returned ONCE in the
 *               response body for the admin to hand to the user - never logged, never stored
 *               anywhere else. Mirrors scripts/createAdminUser.js's own "generate if not given,
 *               show once" convention.
 * @route        POST /api/v1/admin/platform/users/:id/reset-password
 * @access       Private/PlatformAdmin
 */
exports.resetUserPassword = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.params.id);
  if (!user) return next(new ApiError('No user found with that id.', 404));

  const { newPassword } = req.body;
  if (newPassword !== undefined && (typeof newPassword !== 'string' || newPassword.length < 6)) {
    return next(new ApiError('newPassword must be at least 6 characters.', 400));
  }
  const passwordToSet = newPassword || generateStrongPassword();

  // userModel.js's pre('save') hook hashes `password` whenever it's modified - set the plain
  // value here, never pre-hash (see the fix note on createUser above for why pre-hashing here
  // would double-hash it and lock the user out exactly like the original bug).
  user.password = passwordToSet;
  user.passwordChangedAt = Date.now();
  await user.save();

  await logAudit({ actor: req.user, action: 'user.password.reset', targetUser: user, before: null, after: null });

  res.status(200).json(apiResponse('Password reset successfully.', true, { generated: !newPassword, password: newPassword ? undefined : passwordToSet }));
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
