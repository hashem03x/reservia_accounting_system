import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useUser } from "@/context/UserContext";
import { isCustomer } from "@/utils/constants/roles";
import paths from "@/utils/constants/paths";
import LoadingSection from "@/components/ui/sections/loading";

export default function AuthGaurd({ requireLoggedIn }: { requireLoggedIn: boolean }) {
  const { user, isInitializing } = useUser();
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
