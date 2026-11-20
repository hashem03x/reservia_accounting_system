import { Navigate, Outlet } from "react-router-dom";
import paths from "@/utils/constants/paths";
import useIsStaffMember from "@/hooks/useIsStaffMember";
import LoadingSection from "@/components/ui/sections/loading";

// Pre-launch audit (22 Nov 2026): the Central Business Portal is meant to be "the common entry
// point for staff after login" regardless of which system they use - but it was gated by the SAME
// RoleGuard allowlist as the ERP's own route tree (admin/moderator/operator, the legacy ERP role
// field). That assumed "role: 'user'" meant "customer, keep out" - true before this audit, when
// every staff member was always given an ERP role. Now that ERP access is correctly optional (see
// the Create User modal), a real staff member with ONLY CRM or Deal Engine access also has
// role: 'user' and was being bounced straight to /profile, unable to reach the Portal, their own
// user-management pages, or anything else - see bug #2's own fix for why this gate needed to
// change along with it.
//
// Replaces that check with the real question: does this person have ANY reason to be here -
// platform admin, a legacy ERP role, or an active membership in any real system? A genuine
// customer (role: 'user', no memberships, not a platform admin) is still redirected to /profile,
// exactly as originally intended - the signal changed, not the intent.
export default function PortalAccessGuard() {
  const { isStaff, loading } = useIsStaffMember();

  if (loading) return <LoadingSection className="h-screen" />;
  return isStaff ? <Outlet /> : <Navigate to={`/${paths.profile}`} replace />;
}
