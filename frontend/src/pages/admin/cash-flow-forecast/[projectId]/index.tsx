import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import paths from "@/utils/constants/paths";
import { ProjectCashFlowForecast } from "@/types/cashflow";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import ForecastFilters, { ForecastFilterValues } from "../_components/filters";
import SummaryCards from "../_components/summary-cards";
import ForecastChart from "../_components/forecast-chart";
import ObligationsTable from "../_components/obligations-table";

const defaultFilters = (): ForecastFilterValues => {
  const from = new Date();
  const to = new Date(from.getTime() + 30 * 24 * 60 * 60 * 1000);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), granularity: "", project: "", direction: "", status: "" };
};

export default function ProjectCashFlowForecastPage() {
  const { projectId } = useParams();
  const { language, translate, translations } = useLanguage();
  const [filters, setFilters] = useState<ForecastFilterValues>(defaultFilters);

  const {
    privateRequest,
    loading,
    error,
    setError,
    setLoading,
    data: forecast,
    setData: setForecast,
  } = useDataHandler<ProjectCashFlowForecast | null>({ initialData: null, initialLoading: true });

  function load() {
    const params: Record<string, string> = { from: filters.from, to: filters.to };
    if (filters.granularity) params.granularity = filters.granularity;
    if (filters.direction) params.direction = filters.direction;
    if (filters.status) params.status = filters.status;

    handleRequest(language, setLoading, setError, async () => {
      const res = await privateRequest({ url: `cash-flow-forecast/projects/${projectId}`, params, language });
      setForecast(res.data);
    });
  }

  useEffect(() => {
    load();
  }, [projectId, filters.from, filters.to, filters.granularity, filters.direction, filters.status]);

  useDocumentTitle(
    forecast?.project
      ? `${forecast.project.projectNumber} | ${translations.pages.cashFlowForecast} | ${translations.adminPanel}`
      : translations.pages.cashFlowForecast,
  );

  return (
    <AdminLayoutBox
      header={{
        title: translate("Project Cash Flow", "التدفق النقدي للمشروع"),
        subTitle: forecast?.project ? `${forecast.project.projectNumber}${forecast.project.name ? ` - ${forecast.project.name}` : ""}` : undefined,
        backLink: `/${paths.admin}/${paths.cashFlowForecast}`,
      }}
    >
      {loading && !forecast ? (
        <LoadingSection message={translate("Loading project cash flow forecast...", "جاري تحميل التدفق النقدي للمشروع...")} />
      ) : error ? (
        <ErrorSection
          errorTitle={translate("Error loading forecast", "خطأ في تحميل التدفق النقدي")}
          errorMessage={error}
          button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: load }}
        />
      ) : (
        forecast && (
          <div className="flex flex-col gap-4">
            {forecast.project && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <InfoCard label={translate("Customer", "العميل")} value={forecast.project.customer?.name || "-"} />
                <InfoCard
                  label={translate("Contract Value", "قيمة العقد")}
                  value={forecast.project.contractValue != null ? `${forecast.project.contractValue.toLocaleString()} ${translations.currency}` : "-"}
                />
                <InfoCard label={translate("Status", "الحالة")} value={forecast.project.status} />
              </div>
            )}

            <ForecastFilters values={filters} onChange={setFilters} hideProject />
            <SummaryCards forecast={forecast} />
            <ForecastChart timeline={forecast.timeline} loading={loading} />
            <ObligationsTable inflows={forecast.obligations.inflows} outflows={forecast.obligations.outflows} />
          </div>
        )
      )}
    </AdminLayoutBox>
  );
}

function InfoCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-gray-200 p-3">
      <span className="text-xs text-gray-500">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}
