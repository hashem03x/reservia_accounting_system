import { About, AboutContextProps } from "@/types/about";
import { createContext, ReactNode, useContext, useEffect } from "react";
import { useLanguage } from "@/context/LanguageContext";
import apiRequest from "@/utils/helpers/api-request";
import handleRequest from "@/utils/helpers/handle-request";
import useDataHandler from "@/hooks/useDataHandler";

export const AboutContext = createContext<AboutContextProps>({
  data: null,
  setData: () => {},
  loading: true,
  error: "",
  reFetch: () => {},
});

export default function AboutProvider({ children }: { children: ReactNode }) {
  const { language } = useLanguage();

  const { loading, setLoading, error, setError, data, setData } = useDataHandler<About>({
    initialData: null,
  });

  function fetchAbout() {
    handleRequest(language, setLoading, setError, async () => {
      const response = await apiRequest({ url: "about-us", language });
      setData(response.data[response.data.length - 1]);
    });
  }

  useEffect(() => {
    fetchAbout();
  }, []);

  return (
    <AboutContext.Provider value={{ data, setData, loading, error, reFetch: fetchAbout }}>{children}</AboutContext.Provider>
  );
}

export const useAbout = () => useContext(AboutContext);
