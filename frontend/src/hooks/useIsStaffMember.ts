import { useUser } from "@/context/UserContext";
import { useSystemAccess } from "@/context/SystemAccessContext";
import { isCustomer } from "@/utils/constants/roles";

// Pre-launch audit (22 Nov 2026): "is this account a staff member, not a customer" used to be
// answered by `!isCustomer(user.role)` alone - true before ERP access became optional, when every
// staff member was always given a legacy ERP role (admin/moderator/operator). Now a CRM- or Deal-
// Engine-only staff member ALSO has role: 'user', indistinguishable from a real customer by role
// alone. The real signal: platform admin, a legacy ERP role, OR an active membership in any real
// system (CRM/Deal Engine/HR/Website) - shared by AuthGaurd's post-login redirect and
// PortalAccessGuard so the two can never disagree about who counts as staff.
export default function useIsStaffMember() {
  const { user } = useUser();
  const { systems, loading, error } = useSystemAccess();

  if (!user) return { isStaff: false, loading: false };
  if (user.platformAdmin || !isCustomer(user.role)) return { isStaff: true, loading: false };

  // SystemAccessContext's own fetch-on-[user?._id] effect runs AFTER the render that first sees
  // the new `user` - there's a render in between where `loading` is still the PREVIOUS user's
  // (or the logged-out visitor's) stale `false`/null state, before the real fetch for THIS user
  // even starts. Treating `systems === null` as "still loading" too (not just the `loading` flag
  // alone) closes that window - a logged-in user with no data yet is always still loading, unless
  // the fetch has genuinely failed (`error` set).
  if (systems === null && !error) return { isStaff: false, loading: true };
  if (loading) return { isStaff: false, loading: true };
  if (systems === null) return { isStaff: false, loading: false }; // fetch failed - don't hang forever

  const hasAnySystemAccess = Object.values(systems).some(entry => entry.active);
  return { isStaff: hasAnySystemAccess, loading: false };
}
