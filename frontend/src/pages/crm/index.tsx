import { useEffect } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import paths from "@/utils/constants/paths";

export default function Crm() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (location.pathname === `/${paths.crm}` || location.pathname === `/${paths.crm}/`) {
      navigate(paths.pipeline);
    }
  }, [location]);

  return <Outlet />;
}
