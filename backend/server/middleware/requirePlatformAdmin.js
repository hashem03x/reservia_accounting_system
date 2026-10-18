const ApiError = require('../utils/apiError');

// Central Business Portal - gates every platform-wide administration endpoint (routes/portal/
// platformAdminRoute.js). `platformAdmin` is read from `req.user`, the document `authController.
// protect` already loaded and verified from the token - never from the request body, a header,
// or anything else client-supplied, so a user can never grant themself this by editing a request.
// Deliberately NOT bypassed by ERP's own `role === 'admin'`/`isAdmin` - an ordinary ERP
// administrator must not automatically gain platform-wide power (docs section "Central System and
// Role Administration").
module.exports = function requirePlatformAdmin(req, res, next) {
  if (!req.user?.platformAdmin) {
    return next(new ApiError('You do not have platform administration access.', 403));
  }
  next();
};
