const ApiError = require('../utils/apiError');

// Reservia HR Portal access gate (HR Portal Developer Spec section 2) - mirrors
// middleware/commercialAccess.js: an active HR membership, then role checks. The four roles are the
// spec's own: md (everything; approves payroll, reopens, sees all pay), hr (HR officer: people,
// contracts, documents, time, visits, claims; prepares and closes payroll), manager (line manager:
// approves forms, claims and timesheets of direct reports; sees their time, never pay), finance
// (reads the register, journal, tax and insurance; posts to the ERP; no edits to people or time).
//
// `req.hrRole` is always read from the user's own systemMemberships loaded by authController.protect.

const HR_ROLES = ['md', 'hr', 'manager', 'finance'];

function hrMembership(user) {
  if (!user || !Array.isArray(user.systemMemberships)) return null;
  return user.systemMemberships.find(m => m.system === 'HR') || null;
}

exports.requireHrAccess = (req, res, next) => {
  const membership = hrMembership(req.user);
  if (!membership?.isActive || !HR_ROLES.includes(membership.role)) {
    return next(new ApiError('You do not have access to the HR Portal. Contact your administrator.', 403));
  }
  req.hrRole = membership.role;
  return next();
};

exports.requireHrRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.hrRole)) return next(new ApiError('Your HR role does not allow this action.', 403));
  return next();
};

exports.HR_ROLES = HR_ROLES;
exports.hrMembership = hrMembership;
