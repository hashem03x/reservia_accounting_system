import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useUser } from "@/context/UserContext";
import { isCustomer } from "@/utils/constants/roles";
import paths from "@/utils/constants/paths";

export default function AuthGaurd({ requireLoggedIn }: { requireLoggedIn: boolean }) {
  const { user } = useUser();
  const location = useLocation();

  if (requireLoggedIn) {
    return user ? (
      <Outlet />
    ) : (
      <Navigate to={`/${paths.login}`} state={{ from: location.pathname + location.search }} replace={true} />
    );
  }

  return !user ? (
    <Outlet />
  ) : (
    <Navigate
      to={
        location.state?.from
          ? location.state.from
          : isCustomer(user.role)
            ? WebsiteCustomerDistination
            : SystemWorkerDistination
      }
      replace={true}
    />
  );
}

const WebsiteCustomerDistination = `/${paths.profile}`;
const SystemWorkerDistination = `/${paths.admin}`;
