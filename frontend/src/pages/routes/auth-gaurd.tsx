import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useUser } from "@/context/UserContext";
import paths from "@/utils/constants/paths";
import useIsStaffMember from "@/hooks/useIsStaffMember";
import LoadingSection from "@/components/ui/sections/loading";

export default function AuthGaurd({ requireLoggedIn }: { requireLoggedIn: boolean }) {
  const { user, isInitializing } = useUser();
  const { isStaff, loading: staffLoading } = useIsStaffMember();
  const location = useLocation();

  // RememberUser already blocks rendering until session restoration finishes in the normal app
  // tree, but this guard is reused standalone in a couple of places - checking isInitializing here
  // too means it never redirects based on a `user` that just hasn't finished loading yet.
  if (isInitializing) return <LoadingSection className="h-screen" />;

  if (requireLoggedIn) {
    return user ? (
      <Outlet />
    ) : (
      <Navigate to={`/${paths.login}`} state={{ from: location.pathname + location.search }} replace={true} />
    );
  }

  if (!user) return <Outlet />;
  if (location.state?.from) return <Navigate to={location.state.from} replace={true} />;
  // Pre-launch audit (22 Nov 2026): used to be `isCustomer(user.role) ? profile : portal` - wrong
  // now that a CRM/Deal-Engine/HR/Website-only staff member also has role: 'user'. See
  // useIsStaffMember's own header comment; PortalAccessGuard uses the identical signal.
  if (staffLoading) return <LoadingSection className="h-screen" />;
  return <Navigate to={isStaff ? SystemWorkerDistination : WebsiteCustomerDistination} replace={true} />;
}

const WebsiteCustomerDistination = `/${paths.profile}`;
// Central Business Portal: a successful login now lands staff on the Portal, not directly on the
// ERP dashboard (docs section "Authentication and Login Flow" - "Redirect the user to the Central
// Business Portal instead of automatically opening the ERP dashboard").
const SystemWorkerDistination = `/${paths.portal}`;
