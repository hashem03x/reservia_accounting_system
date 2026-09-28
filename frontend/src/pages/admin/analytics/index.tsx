import { useLanguage } from "@/context/LanguageContext";
import { useEffect } from "react";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import type { AnalyticsData, CategorySales } from "@/types/analytics";

import DailySales from "./components/daily-sales";
import OrderStats from "./components/order-stats";
import CustomerInsights from "./components/customer-insights";
import TopSellingProducts from "./components/top-selling-products";
import ProductsPerformance from "./components/products-performance";
import MainCategoriesRevenue from "./components/main-categories-revenue";
import WishlistAnalysis from "./components/wishlist-analysis";
import SalesBySubCategoryChart from "./components/sales-by-sub-category";
import ProductAvailability from "./components/product-availability";
import WarehousesBalance from "./components/warehouses-balance";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";

export default function Analytics() {
  const { language, translate } = useLanguage();
  const { privateRequest, loading, setLoading, error, setError, setData } = useDataHandler<AnalyticsData | null>({
    initialData: null,
    initialLoading: true,
  });

  useDocumentTitle(
    `${language === "en-US" ? "Analytics" : "التحليلات"} | ${language === "en-US" ? "Admin Panel" : "لوحة التحكم"}`,
  );

  function handleLoadData() {
    const controller = new AbortController();
    const canceled = { current: false };

    const executeFetch = async () => {
      const [
        topSellingProducts,
        productPerformance,
        salesBySubCategory,
        customerInsights,
        wishlistAnalysis,
        orderStatistics,
        salesByTimePeriod,
        productAvailability,
      ] = await Promise.all([
        privateRequest({
          url: "analytics/top-selling-products",
          signal: controller.signal,
          language,
        }),
        privateRequest({
          url: "analytics/product-performance",
          signal: controller.signal,
          language,
        }),
        privateRequest({
          url: "analytics/sales-by-sub-category",
          signal: controller.signal,
          language,
        }),
        privateRequest({
          url: "analytics/customer-insights",
          signal: controller.signal,
          language,
        }),
        privateRequest({
          url: "analytics/wishlist-analysis",
          signal: controller.signal,
          language,
        }),
        privateRequest({
          url: "analytics/order-statistics",
          signal: controller.signal,
          language,
        }),
        privateRequest({
          url: "analytics/sales-by-time-period",
          params: {
            startDate: new Date(new Date().setFullYear(new Date().getFullYear() - 1)).toISOString(),
            endDate: new Date().toISOString(),
            groupBy: "month",
          },
          signal: controller.signal,
          language,
        }),
        privateRequest({
          url: "analytics/product-availability",
          signal: controller.signal,
          language,
        }),
      ]);

      setData({
        topSellingProducts: topSellingProducts.data,
        productPerformance: productPerformance.data,
        salesBySubCategory: {
          data: salesBySubCategory.data,
          summary: {
            totalRevenue: salesBySubCategory.data.reduce((sum: number, cat: CategorySales) => sum + cat.totalRevenue, 0),
            totalOrders: salesBySubCategory.data.reduce((sum: number, cat: CategorySales) => sum + cat.numberOfOrders, 0),
            averageOrderValue:
              salesBySubCategory.data.reduce((sum: number, cat: CategorySales) => sum + cat.averageOrderValue, 0) /
              salesBySubCategory.data.length,
            totalCategories: salesBySubCategory.data.length,
            totalSubcategories: salesBySubCategory.data.reduce(
              (sum: number, cat: CategorySales) => sum + cat.subcategories.length,
              0,
            ),
            totalQuantitySold: salesBySubCategory.data.reduce(
              (sum: number, cat: CategorySales) => sum + cat.totalQuantitySold,
              0,
            ),
          },
        },
        customerInsights: customerInsights.data,
        wishlistAnalysis: wishlistAnalysis.data,
        orderStatistics: orderStatistics.data,
        salesByTimePeriod: salesByTimePeriod.data,
        productAvailability: productAvailability.data,
      });
    };

    handleRequest(language, setLoading, setError, executeFetch, canceled);

    return () => {
      controller.abort();
      canceled.current = true;
    };
  }

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
    const cancelRequest = handleLoadData();
    return cancelRequest;
  }, [language]);

  if (loading) {
    return (
      <LoadingSection
        message={translate("Loading analytics...", "جار تحميل التحليلات...")}
        className="min-h-full bg-white shadow"
      />
    );
  }

  if (error) {
    return (
      <ErrorSection
        errorTitle={translate("Error loading analytics", "خطأ في تحميل التحليلات")}
        errorMessage={error}
        button={{ text: translate("Retry", "إعادة المحاولة"), onClick: handleLoadData }}
        className="min-h-full bg-white shadow"
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-1">
        <DailySales height="auto" />
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <ProductsPerformance height="400px" />
        <MainCategoriesRevenue height="400px" />
      </div>

      <div className="grid grid-cols-1 gap-6">
        <SalesBySubCategoryChart height="500px" />
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <WishlistAnalysis height="auto" />
        <ProductAvailability height="auto" />
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <CustomerInsights height="650px" />
        <TopSellingProducts height="650px" />
        <OrderStats height="800px" />
        <WarehousesBalance height="auto" />
      </div>
    </div>
  );
}

/**
 * update @warehouses-balance and @index.tsx 
 * also updat @analy and check @analy
 * the endpoint {{URL}}/analytics/warehouses-balance?startDate=2024-08-01&endDate=2025-08-31&warehouseId=67933fd03bf29b9f172eeab6 check how we handle warehouseId in the filter in @daily-sales as a reference
 * the response body is :
{
    "status": "success",
    "data": {
        "totalBalance": 5599980,
        "USD": 40000,
        "EUR": 0,
        "TRY": 0,
        "CNY": 0
    }
}
    "npm run build" to make sure you don't have any errors
 */
