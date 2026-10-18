import { BrandsContextProps, Brand } from "@/types/categories";
import { createContext, ReactNode, useContext, useEffect } from "react";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import apiRequest from "@/utils/helpers/api-request";

// Mirrors SubcategoriesContext.tsx exactly - fetch-once-on-mount, same shape. Brand is now the
// primary product identification field under Category (replaces Subcategory).
export const BrandsContext = createContext<BrandsContextProps>({
  data: [],
  setData: () => {},
  loading: true,
  error: "",
  reFetch: () => {},
});

export default function BrandsProvider({ children }: { children: ReactNode }) {
  const { language } = useLanguage();

  const { loading, setLoading, error, setError, data, setData } = useDataHandler<Brand[]>({
    initialData: [],
    initialLoading: true,
  });

  function getBrands() {
    handleRequest(language, setLoading, setError, async () => {
      const response = await apiRequest({ url: "brands", params: { limit: 500 }, language });
      setData(response.data);
    });
  }

  useEffect(() => {
    getBrands();
  }, []);

  return (
    <BrandsContext.Provider value={{ data, setData, loading, error, reFetch: getBrands }}>
      {children}
    </BrandsContext.Provider>
  );
}

export const useBrands = () => useContext(BrandsContext);
