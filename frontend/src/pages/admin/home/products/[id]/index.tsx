import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { Product as ProductType } from "@/types/product";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import ProductHandler from "../_components/product-handler";

export default function Product() {
  const { language, translate, translations } = useLanguage();

  useDocumentTitle(`${translate("Product Information", "معلومات المنتج")} | ${translations.adminPanel}`);

  const { id } = useParams<{ id: string }>();

  const {
    privateRequest,
    loading,
    setLoading,
    error,
    setError,
    data: product,
    setData: setProduct,
  } = useDataHandler<ProductType | null>({ initialData: null, initialLoading: true });

  function handleLoadProduct() {
    const controller = new AbortController();
    const canceled = { current: false };

    const executeFetch = async () => {
      const response = await privateRequest({ url: `products/${id}`, signal: controller.signal, language });
      if (response.data.isDeleted) setError(translate("This product does not exist.", "هذا المنتج غير موجود."));
      else setProduct(response.data);
    };

    handleRequest(language, setLoading, setError, executeFetch, canceled);

    // Return a function to cancel this request
    return () => {
      controller.abort();
      canceled.current = true;
    };
  }

  useEffect(() => {
    const cancelRequest = handleLoadProduct(); // This will send the request and return the function to cancel it.
    return cancelRequest; // This will be called when the component unmounts.
  }, []);

  return loading ? (
    <LoadingSection
      message={translate("Loading product information", "جاري تحميل معلومات المنتج")}
      className="min-h-full bg-white shadow"
    />
  ) : error ? (
    <ErrorSection
      errorTitle={translate("Error loading product information", "خطأ في تحميل معلومات المنتج")}
      errorMessage={error}
      button={{ text: translate("Retry", "إعادة المحاولة"), onClick: handleLoadProduct }}
      className="min-h-full bg-white shadow"
    />
  ) : (
    product && <ProductHandler product={product} />
  );
}
