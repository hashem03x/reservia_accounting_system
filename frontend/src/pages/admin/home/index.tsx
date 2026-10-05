import { useEffect } from "react";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { DashboardSummary } from "@/types/dashboard";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import KpiSection from "./_components/kpi-section";
import SalesTrendChart from "./_components/sales-trend-chart";
import CashPositionSection from "./_components/cash-position-section";
import ProjectExecutionSection from "./_components/project-execution-section";
import RecentJournalEntriesSection from "./_components/recent-journal-entries-section";
import RecentSalesOrdersSection from "./_components/recent-sales-orders-section";
import RecentPurchaseOrdersSection from "./_components/recent-purchase-orders-section";
import QuickActionsSection from "./_components/quick-actions-section";

// Admin Home / Dashboard (docs section "Admin Home / Dashboard") - the central control center for
// Reservia Integrated Energy. The top KPI row + Sales Trend + Cash position all come from a SINGLE
// read-only aggregation (GET /dashboard/summary, fetched once here and passed down) - never one
// API call per widget for those. The "recent activity" sections (Projects, Journal Entries, Sales/
// Purchase Orders) each fetch independently from their own existing small-limit list endpoints, so
// one failing section never takes down the rest of the page (docs section "Error Handling").
export default function Home() {
  const { language, translate, translations } = useLanguage();

  useDocumentTitle(`${translations.pages.home} | ${translations.adminPanel}`);

  const {
    privateRequest,
    loading,
    setLoading,
    error,
    setError,
    data: summary,
    setData: setSummary,
  } = useDataHandler<DashboardSummary | null>({
    initialData: null,
    initialLoading: true,
  });

  function loadSummary() {
    const controller = new AbortController();
    const canceled = { current: false };

    const executeFetch = async () => {
      const response = await privateRequest({ url: "dashboard/summary", signal: controller.signal, language });
      setSummary(response.data);
    };

    handleRequest(language, setLoading, setError, executeFetch, canceled);

    return () => {
      controller.abort();
      canceled.current = true;
    };
  }

  useEffect(() => {
    const cancelRequest = loadSummary();
    return cancelRequest;
  }, []);

  return (
    <AdminLayoutBox
      header={{
        title: translate("Reservia Integrated Energy", "ريزيرفيا للطاقة المتكاملة"),
        subTitle: translate(
          "Projects, sales, purchases and cash position at a glance.",
          "المشاريع والمبيعات والمشتريات والوضع النقدي في نظرة واحدة.",
        ),
      }}
    >
      <div className="flex flex-col gap-5">
        <KpiSection summary={summary} loading={loading} error={error} onRetry={loadSummary} />

        <QuickActionsSection />

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <SalesTrendChart summary={summary} loading={loading} error={error} onRetry={loadSummary} />
          </div>
          <CashPositionSection summary={summary} loading={loading} error={error} onRetry={loadSummary} />
        </div>

        <ProjectExecutionSection />

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <RecentSalesOrdersSection />
          <RecentPurchaseOrdersSection />
        </div>

        <RecentJournalEntriesSection />

      </div>
    </AdminLayoutBox>
  );
}
