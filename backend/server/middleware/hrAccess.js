const ApiError = require('../utils/apiError');

// Reservia HR Portal access gate (HR Portal Developer Spec section 2) - mirrors
// middleware/commercialAccess.js: an active HR membership, then role checks. The original four
// roles are the spec's own: md (everything; approves payroll, reopens, sees all pay), hr (HR
// officer: people, contracts, documents, time, visits, claims; prepares and closes payroll),
// manager (line manager: approves forms, claims and timesheets of direct reports; sees their
// time, never pay), finance (reads the register, journal, tax and insurance; posts to the ERP;
// no edits to people or time). Go-live Developer Pack section 5.7/D6/D7 adds two more: employee
// (every staff member - self-service only: own profile/attendance/visits/claims/documents, no
// approval rights over anyone) and line_manager (functionally identical to manager - approves
// their own direct reports via HrEmployee.mgrId; see services/hr/hrCore.js#assertCanDecideFor,
// which treats manager/line_manager the same). Without these two, every go-live staff account
// provisioned with an HR role other than md/hr/finance would be locked out of the HR Portal
// entirely - this exact gap was caught only after the real accounts were created.
//
// `req.hrRole` is always read from the user's own systemMemberships loaded by authController.protect.

const HR_ROLES = ['md', 'hr', 'manager', 'finance', 'employee', 'line_manager'];

function hrMembership(user) {
  if (!user || !Array.isArray(user.systemMemberships)) return null;
  return user.systemMemberships.find(m => m.system === 'HR') || null;
}

// Go-live Developer Pack, section 3/4: platform administration and the Global Super Admin test
// flag must NEVER automatically grant MD approval authority (payroll approval is MD-only, F10) -
// a super admin now needs a REAL, explicit HR membership like anyone else. This file used to
// force req.hrRole = 'md' for any globalSuperAdmin account - the same class of bypass fixed in
// middleware/commercialAccess.js and middleware/crmAccess.js. Removed.
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
