import { SubcategoriesContextProps, Subcategory } from "@/types/categories";
import { createContext, ReactNode, useContext, useEffect } from "react";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import apiRequest from "@/utils/helpers/api-request";

export const SubcategoriesContext = createContext<SubcategoriesContextProps>({
  data: [],
  setData: () => {},
  loading: true,
  error: "",
  reFetch: () => {},
});

export default function SubCategoriesProvider({ children }: { children: ReactNode }) {
  const { language } = useLanguage();

  const { loading, setLoading, error, setError, data, setData } = useDataHandler<Subcategory[]>({
    initialData: [],
    initialLoading: true,
  });

  function getSubcategories() {
    handleRequest(language, setLoading, setError, async () => {
      const response = await apiRequest({ url: "subcategories", params: { display: true }, language });
      setData(response.data);
    });
  }

  useEffect(() => {
    getSubcategories();
  }, []);

  return (
    <SubcategoriesContext.Provider value={{ data, setData, loading, error, reFetch: getSubcategories }}>
      {children}
    </SubcategoriesContext.Provider>
  );
}

export const useSubcategories = () => useContext(SubcategoriesContext);
