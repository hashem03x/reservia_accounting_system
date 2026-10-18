import { useUser } from "@/context/UserContext";
import { Navigate, Outlet } from "react-router-dom";
import paths from "@/utils/constants/paths";

// Central Business Portal - gates the dedicated platform-administration pages
// (pages/portal/admin). `platformAdmin` is distinct from ERP's own `role`/`isAdmin` - an ordinary
// ERP administrator must not reach these pages just by being role==="admin" (docs section
// "Central System and Role Administration"). The backend's requirePlatformAdmin middleware is
// the real authority; this is presentation-layer only.
export default function PlatformAdminGuard() {
  const { user } = useUser();

  if (!user) return <Navigate to={`/${paths.login}`} replace />;
  if (!user.platformAdmin) return <Navigate to={`/${paths.portal}`} replace />;

  return <Outlet />;
}
