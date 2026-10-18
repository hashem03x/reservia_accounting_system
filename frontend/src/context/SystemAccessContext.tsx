import { createContext, ReactNode, useContext, useEffect } from "react";
import { useUser } from "@/context/UserContext";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { SystemAccessMap, SystemAccessContextProps } from "@/types/systems";

// Central Business Portal - the frontend's one source of "what can the current user access"
// (docs section "Load authorized systems"). Fetched from GET /me/systems - the backend is always
// the authority; this context only caches that response for the Portal cards and SystemGuard to
// both read without each firing their own request. Never inferred from local storage or any
// client-side role check.
export const SystemAccessContext = createContext<SystemAccessContextProps>({
  systems: null,
  loading: true,
  error: "",
  reFetch: () => {},
});

export default function SystemAccessProvider({ children }: { children: ReactNode }) {
  const { user } = useUser();
  const { language } = useLanguage();

  const { privateRequest, loading, setLoading, error, setError, data, setData } = useDataHandler<SystemAccessMap | null>({
    initialData: null,
    initialLoading: true,
  });

  function getSystemAccess() {
    if (!user) {
      setLoading(false);
      return;
    }
    handleRequest(language, setLoading, setError, async () => {
      const response = await privateRequest({ url: "me/systems", language });
      setData(response.data);
    });
  }

  useEffect(() => {
    getSystemAccess();
  }, [user?._id]);

  return (
    <SystemAccessContext.Provider value={{ systems: data, loading, error, reFetch: getSystemAccess }}>
      {children}
    </SystemAccessContext.Provider>
  );
}

export const useSystemAccess = () => useContext(SystemAccessContext);
