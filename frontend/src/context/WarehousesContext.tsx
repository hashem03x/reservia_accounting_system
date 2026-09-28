import { Warehouse, WarehousesContextProps } from "@/types/warehouse";
import { createContext, ReactNode, useContext, useEffect } from "react";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import apiRequest from "@/utils/helpers/api-request";

export const WarehousesContext = createContext<WarehousesContextProps>({
  data: [],
  setData: () => {},
  loading: true,
  error: "",
  reFetch: () => {},
});

export default function WarehousesProvider({ children }: { children: ReactNode }) {
  const { language } = useLanguage();

  const { loading, setLoading, error, setError, data, setData } = useDataHandler<Warehouse[]>({
    initialData: [],
    initialLoading: true,
  });

  function getWarehouses() {
    handleRequest(language, setLoading, setError, async () => {
      const response = await apiRequest({ url: "warehouses", params: { isDeleted: false }, language });
      setData(response.data);
    });
  }

  useEffect(() => {
    getWarehouses();
  }, []);

  return (
    <WarehousesContext.Provider value={{ data, setData, loading, error, reFetch: getWarehouses }}>
      {children}
    </WarehousesContext.Provider>
  );
}

export const useWarehouses = () => useContext(WarehousesContext);
