const asyncHandler = require('express-async-handler');
const { getEffectiveSystemAccess } = require('../../utils/systemAccess');
const apiResponse = require('../../utils/apiResponse');

// Central Business Portal - `req.user` is already the verified document `authController.protect`
// loaded from the token; both endpoints below return ONLY the current caller's own data, never
// another user's (docs section "API Design" - "The system-access endpoint should return only the
// current user's effective access, not information about other users").

/**
 * @description  Current authenticated identity - no password hash, no systemMemberships array
 *               internals beyond what the caller is entitled to see about themself.
 * @route        GET /api/v1/me
 * @access       Private
 */
exports.getMe = asyncHandler(async (req, res) => {
  const { _id, name, email, phone, role, isActive, platformAdmin } = req.user;
  res.status(200).json(apiResponse('OK', true, { _id, name, email, phone, role, isActive, platformAdmin }));
});

/**
 * @description  The caller's own effective access map across every registered system.
 * @route        GET /api/v1/me/systems
 * @access       Private
 */
exports.getMySystems = asyncHandler(async (req, res) => {
  res.status(200).json(apiResponse('OK', true, getEffectiveSystemAccess(req.user)));
});
