import { useEffect } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import paths from "@/utils/constants/paths";

export default function Crm() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    // Acceptance report section 4: "Add a Dashboard as the first menu item and the screen users
    // land on after login" - a bare /crm now lands here, not on Pipeline.
    if (location.pathname === `/${paths.crm}` || location.pathname === `/${paths.crm}/`) {
      navigate(paths.dashboard);
    }
  }, [location]);

  return <Outlet />;
}
