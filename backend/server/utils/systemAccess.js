const { SYSTEMS } = require('./systemsRegistry');

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
  const result = {};
  for (const systemId of Object.keys(SYSTEMS)) {
    const system = SYSTEMS[systemId];
    const membership = memberships.find(m => m.system === systemId);
    const hasActiveMembership = !!membership?.isActive;
    result[systemId] = {
      implemented: system.implemented,
      active: system.implemented && hasActiveMembership,
      hasMembership: hasActiveMembership,
      role: hasActiveMembership ? membership.role : null,
    };
  }
  return result;
};
