const { SYSTEMS } = require('./systemsRegistry');

// Feature 5 - the Global Super Administrator (testing account), distinct from `platformAdmin`
// (Central Business Portal user/membership management only - unchanged, see userModel.js's own
// comment on why these are two separate flags). A global super admin bypasses every system
// membership check below; every CALLER that also bypasses a business-workflow restriction (CRM
// stage transitions, Deal Engine approval roles) logs that specific override itself, via
// services/system/superAdminAuditService.js - this flag alone does not write an audit entry.
exports.isGlobalSuperAdmin = function isGlobalSuperAdmin(user) {
  return !!user?.globalSuperAdmin;
};

// Central Business Portal - the ONE place "does this user currently have active ERP access" is
// computed, shared by middleware/hasPermission.js#checkUserPermissions,
// controller/user/authController.js#allowedTo, and GET /me/systems, so the three can never
// disagree about what counts as active ERP membership.
//
// A user with NO 'ERP' entry in systemMemberships has no ERP access, full stop - there is no
// "grandfathered in" case here. Every legitimate existing staff account gets its entry from
// scripts/backfillErpSystemMemberships.js, which must run before this check starts being
// enforced (see that script's own header comment).
exports.hasActiveErpMembership = function hasActiveErpMembership(user) {
  if (exports.isGlobalSuperAdmin(user)) return true;
  if (!user || !Array.isArray(user.systemMemberships)) return false;
  return user.systemMemberships.some(m => m.system === 'ERP' && m.isActive);
};

// The caller's own effective access map for every registered system - `GET /me/systems`'s exact
// payload. `active` is false for ANY system the registry marks `implemented: false`, regardless
// of membership - the portal must never claim a system is open for business before it exists
// (docs section "Website and Future Module Architecture" - "do not falsely imply... already
// exists").
exports.getEffectiveSystemAccess = function getEffectiveSystemAccess(user) {
  const memberships = Array.isArray(user?.systemMemberships) ? user.systemMemberships : [];
  const superAdmin = exports.isGlobalSuperAdmin(user);
  const result = {};
  for (const systemId of Object.keys(SYSTEMS)) {
    const system = SYSTEMS[systemId];
    const membership = memberships.find(m => m.system === systemId);
    const hasActiveMembership = !!membership?.isActive;
    const highestRole = Array.isArray(system.roles) && system.roles.length ? system.roles[0] : null;
    result[systemId] = {
      implemented: system.implemented,
      // HR: a membership left over from the placeholder era ('MEMBER') carries no permission level,
      // so it never opens the HR Portal (pay data) - it must be re-granted with a real HR role.
      // A global super admin is active on every IMPLEMENTED system regardless of membership - never
      // on a not-yet-implemented one, same "never falsely imply it already exists" rule as everyone.
      active: system.implemented && (superAdmin || (hasActiveMembership && (!system.requireValidRole || system.roles.includes(membership.role)))),
      hasMembership: hasActiveMembership || superAdmin,
      role: hasActiveMembership ? membership.role : superAdmin ? highestRole : null,
    };
  }
  return result;
};
