import { useUser } from "@/context/UserContext";
import { Navigate, Outlet } from "react-router-dom";
import paths from "@/utils/constants/paths";

export default function RoleGuard({ allowedRoles }: { allowedRoles: string[] }) {
  const { user } = useUser();

  if (user) return allowedRoles.includes(user.role) ? <Outlet /> : <Navigate to={`/${paths.profile}`} />;
  else return <Outlet />;
}
