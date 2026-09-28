import { MainCategoriesContextProps, MainCategory } from "@/types/categories";
import { createContext, ReactNode, useContext, useEffect } from "react";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import apiRequest from "@/utils/helpers/api-request";

export const MainCategoriesContext = createContext<MainCategoriesContextProps>({
  data: [],
  setData: () => {},
  loading: true,
  error: "",
  reFetch: () => {},
});

export default function MainCategoriesProvider({ children }: { children: ReactNode }) {
  const { language } = useLanguage();

  const { loading, setLoading, error, setError, data, setData } = useDataHandler<MainCategory[]>({
    initialData: [],
    initialLoading: true,
  });

  function getMainCategories() {
    handleRequest(language, setLoading, setError, async () => {
      const response = await apiRequest({ url: "categories", params: { isDeleted: false }, language });
      setData(response.data.reverse());
    });
  }

  useEffect(() => {
    getMainCategories();
  }, []);

  return (
    <MainCategoriesContext.Provider value={{ data, setData, loading, error, reFetch: getMainCategories }}>
      {children}
    </MainCategoriesContext.Provider>
  );
}

export const useMainCategories = () => useContext(MainCategoriesContext);
