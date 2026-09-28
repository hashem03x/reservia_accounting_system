import { Governorate, GovernorateContextProps } from "@/types/governorate";
import { createContext, ReactNode, useContext, useEffect } from "react";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import apiRequest from "@/utils/helpers/api-request";

export const GovernorateContext = createContext<GovernorateContextProps>({
  data: [],
  setData: () => {},
  loading: true,
  error: "",
  reFetch: () => {},
});

export default function GovernorateProvider({ children }: { children: ReactNode }) {
  const { language } = useLanguage();

  const { loading, setLoading, error, setError, data, setData } = useDataHandler<Governorate[]>({
    initialData: [],
    initialLoading: true,
  });

  function getGovernorates() {
    handleRequest(language, setLoading, setError, async () => {
      const response = await apiRequest({ url: "governorates", language });
      setData(response.data);
    });
  }

  useEffect(() => {
    getGovernorates();
  }, []);

  return (
    <GovernorateContext.Provider value={{ data, setData, loading, error, reFetch: getGovernorates }}>
      {children}
    </GovernorateContext.Provider>
  );
}

export const useGovernorates = () => useContext(GovernorateContext);
