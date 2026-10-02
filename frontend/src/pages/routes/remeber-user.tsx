import { useEffect, useRef } from "react";
import { useUser } from "@/context/UserContext";
import useRefresh from "@/hooks/useRefresh";
import useLogout from "@/hooks/useLogout";
import LoadingSection from "@/components/ui/sections/loading";

// Gates rendering the rest of the app (including the router/AuthGaurd) on session restoration
// actually finishing - a hard refresh always resets `user` to null (it only ever lives in React
// state), so the only durable signal of a prior session is the "remember" localStorage flag; the
// real credential is the httpOnly refresh-token cookie, redeemed via refreshAccessToken() below.
// Without this gate, AuthGaurd would see `user === null` on the very first render and redirect to
// /login before this async restoration attempt has had a chance to resolve (or even start, since
// effects run after paint) - losing the race every time even with a perfectly valid session.
function RememberUser({ children }: { children: React.ReactNode }) {
  const { user, isInitializing, setIsInitializing } = useUser();

  const accessToken = user?.accessToken;

  const remember = localStorage.getItem("remember") === "true";

  const refreshAccessToken = useRefresh();

  const logout = useLogout();

  // in StrictMode, this component will be rendered twice causing the refreshAccessToken to be called twice.
  const effectHasRun = useRef(false);

  useEffect(() => {
    if (accessToken) {
      // Already authenticated (e.g. just logged in this session) - nothing to restore.
      setIsInitializing(false);
      return;
    }

    if (!remember) {
      // No prior "remember me" session to restore - stop waiting immediately.
      setIsInitializing(false);
      return;
    }

    if (effectHasRun.current) return;
    effectHasRun.current = true;

    (async () => {
      try {
        await refreshAccessToken();
      } catch (error) {
        await logout();
      } finally {
        setIsInitializing(false);
      }
    })();
  }, [accessToken, remember, refreshAccessToken, logout, setIsInitializing]);

  if (isInitializing) return <LoadingSection className="h-screen" />;

  return children;
}

export default RememberUser;
