import { useEffect, useRef } from "react";
import { useUser } from "@/context/UserContext";
import useRefresh from "@/hooks/useRefresh";
import useLogout from "@/hooks/useLogout";

function RememberUser({ children }: { children: React.ReactNode }) {
  const { user } = useUser();

  const accessToken = user?.accessToken;

  const remember = localStorage.getItem("remember") === "true";

  const refreshAccessToken = useRefresh();

  const logout = useLogout();

  // in StrictMode, this component will be rendered twice causing the refreshAccessToken to be called twice.
  const effectHasRun = useRef(false);

  useEffect(() => {
    if (!accessToken && remember && !effectHasRun.current) {
      effectHasRun.current = true;
      (async () => {
        try {
          await refreshAccessToken();
        } catch (error) {
          await logout();
        }
      })();
    }
  }, [accessToken, remember, refreshAccessToken, logout]);

  return children;
}

export default RememberUser;
