import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { CashFlowForecast } from "@/types/cashflow";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import ForecastFilters, { ForecastFilterValues } from "./filters";
import SummaryCards from "./summary-cards";
import ForecastChart from "./forecast-chart";
import ObligationsTable from "./obligations-table";

const defaultFilters = (): ForecastFilterValues => {
  const from = new Date();
  const to = new Date(from.getTime() + 30 * 24 * 60 * 60 * 1000);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    granularity: "",
    project: "",
    direction: "",
    status: "",
  };
};

/** Shared by the consolidated and single-project forecast pages - only the fetch URL differs. */
export default function ForecastView({ url, hideProjectFilter = false }: { url: string; hideProjectFilter?: boolean }) {
  const { language, translate } = useLanguage();
  // Honors a deep link from the dashboard's forecast cards (e.g. "?direction=in",
  // "?status=overdue") as the initial filter selection, read once on mount.
  const [searchParams] = useSearchParams();
  const [filters, setFilters] = useState<ForecastFilterValues>(() => ({
    ...defaultFilters(),
    direction: searchParams.get("direction") || "",
    status: searchParams.get("status") || "",
    project: searchParams.get("project") || "",
  }));

  const {
    privateRequest,
    loading,
    error,
    setError,
    setLoading,
    data: forecast,
    setData: setForecast,
  } = useDataHandler<CashFlowForecast | null>({ initialData: null, initialLoading: true });

  function load() {
    const params: Record<string, string> = { from: filters.from, to: filters.to };
    if (filters.granularity) params.granularity = filters.granularity;
    if (filters.project && !hideProjectFilter) params.project = filters.project;
    if (filters.direction) params.direction = filters.direction;
    if (filters.status) params.status = filters.status;

    handleRequest(language, setLoading, setError, async () => {
      const res = await privateRequest({ url, params, language });
      setForecast(res.data);
    });
  }

  useEffect(() => {
    load();
  }, [filters.from, filters.to, filters.granularity, filters.project, filters.direction, filters.status]);

  return (
    <div className="flex flex-col gap-4">
      <ForecastFilters values={filters} onChange={setFilters} hideProject={hideProjectFilter} />

      {loading && !forecast ? (
        <LoadingSection message={translate("Loading cash flow forecast...", "جاري تحميل التدفق النقدي المتوقع...")} />
      ) : error ? (
        <ErrorSection
          errorTitle={translate("Error loading forecast", "خطأ في تحميل التدفق النقدي")}
          errorMessage={error}
          button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: load }}
        />
      ) : (
        forecast && (
          <>
            <SummaryCards forecast={forecast} />
            <ForecastChart timeline={forecast.timeline} loading={loading} />
            <ObligationsTable inflows={forecast.obligations.inflows} outflows={forecast.obligations.outflows} />
          </>
        )
      )}
    </div>
  );
}
