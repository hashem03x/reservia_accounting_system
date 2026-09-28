import { useLanguage } from "@/context/LanguageContext";
import translate from "@/utils/helpers/translate";
import { useEffect, useState } from "react";
import useFetchingStatus from "@/hooks/useFetchingStatus";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import handleRequest from "@/utils/helpers/handle-request";
import ErrorSection from "@/components/ui/sections/error";
import Loader from "./loader";
import Box from "./box";
import { Link } from "react-router-dom";
import paths from "@/utils/constants/paths";
import { solidIcons } from "@/components/icons";
import EmptySection from "@/components/ui/sections/empty";
import { WishlistedProduct } from "@/types/analytics";

type WishlistAnalysisType = WishlistedProduct[];

export default function WishlistAnalysis({ height }: { height: string }) {
  const { language } = useLanguage();

  const [data, setData] = useState<WishlistAnalysisType | null>(null);

  const { loading, setLoading, error, setError } = useFetchingStatus();
  const privateRequest = usePrivateRequest();

  function getData() {
    const controller = new AbortController();
    const canceled = { current: false };

    const executeFetch = async () => {
      const response = await privateRequest({
        url: "analytics/wishlist-analysis",
        signal: controller.signal,
        language,
      });
      setData(response.data?.topWishlistedProducts);
    };

    handleRequest(language, setLoading, setError, executeFetch, canceled);

    return () => {
      controller.abort();
      canceled.current = true;
    };
  }

  useEffect(() => {
    const cancelRequest = getData();
    return cancelRequest;
  }, []);

  return (
    <Box height={height}>
      <h3 className="mb-1">{translate(language, "Wishlist Analysis", "تحليل قائمة الرغبات")}</h3>
      <p className="mb-4 text-xs sm:text-sm">
        {translate(language, "Explore the most wishlisted products.", "استكشف المنتجات الأكثر رغبة.")}
      </p>
      {loading ? (
        <Loader />
      ) : error ? (
        <ErrorSection
          errorTitle={translate(language, "Error Generating Report", "خطأ في تحميل التقرير")}
          errorMessage={error}
          button={{ text: translate(language, "Try Again", "حاول مرة أخرى"), onClick: getData }}
        />
      ) : (
        data && (
          <div className="hide-scrollbar flex flex-1 animate-fade-in flex-col gap-3 overflow-y-auto">
            {data.length === 0 ? (
              <EmptySection
                message={translate(language, "No data available", "لا تتوفر بيانات")}
                className="flex-1 border-0"
              />
            ) : (
              data.slice(0, 3).map((product, index) => (
                <div
                  key={product._id}
                  className="flex items-center justify-between gap-2 rounded-md border border-gray-100 bg-gray-50 p-3 shadow"
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <Link
                      to={`/${paths.products}/${product._id}`}
                      className="truncate text-sm font-bold text-gray-800 hover:text-gray-600"
                    >
                      {index + 1}. {translate(language, product.productTitle.en, product.productTitle.ar)}
                    </Link>
                    <p className="text-sm text-gray-600">
                      {translate(language, "Price", "السعر")}: {product.productPrice} {translate(language, "EGP", "ج.م")}
                    </p>
                  </div>
                  <span
                    title={translate(language, "Wishlist Count", "عدد الرغبات")}
                    className="flex-center gap-2 rounded-full bg-red-50 px-2 py-1 text-xs font-semibold"
                  >
                    <span className="text-gray-800">{product.count}</span>
                    <solidIcons.Heart className="animate-bounce text-rose-600" />
                  </span>
                </div>
              ))
            )}
          </div>
        )
      )}
    </Box>
  );
}
