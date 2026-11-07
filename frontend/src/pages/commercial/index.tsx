import { useEffect } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import paths from "@/utils/constants/paths";

// Mirrors pages/crm/index.tsx - a bare /commercial lands on the Dashboard.
export default function Commercial() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (location.pathname === `/${paths.commercial}` || location.pathname === `/${paths.commercial}/`) {
      navigate(paths.dashboard);
    }
  }, [location]);

  return <Outlet />;
}
