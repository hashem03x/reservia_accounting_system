import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Badge } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import { ReportCatalog, ReportKind } from "@/types/accounting-report";

// The accounting reports, grouped by category (from the backend catalog).
export default function FinancialReports() {
  const { language, translate, translations } = useLanguage();
  const isArabic = language === "ar-EG";
  useDocumentTitle(`${translations.pages.financialReports} | ${translations.adminPanel}`);

  const { privateRequest, loading, setLoading, error, setError, data: catalog, setData } = useDataHandler<ReportCatalog | null>({ initialData: null, initialLoading: true });
  function load() {
    handleRequest(language, setLoading, setError, async () => {
      const res = await privateRequest({ url: "accounting-reports", language });
      setData(res.data);
    });
  }
  useEffect(() => {
    load();
  }, []);

  const kindLabel: Record<ReportKind, string> = {
    period: translate("Period", "عن فترة"),
    asOf: translate("As of a date", "في تاريخ"),
    list: translate("List", "بيان"),
  };

  return (
    <AdminLayoutBox header={{ title: translations.pages.financialReports }}>
      {loading ? (
        <LoadingSection message={translate("Loading reports...", "جاري تحميل التقارير...")} />
      ) : error ? (
        <ErrorSection errorTitle={translate("Error loading reports", "خطأ في تحميل التقارير")} errorMessage={error} button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: load }} />
      ) : (
        catalog && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {catalog.categories.map((category, ci) => (
              <section key={category.key} className="flex flex-col gap-2 rounded-lg border border-gray-100 p-4">
                <h3 className="font-semibold">
                  {String.fromCharCode(65 + ci)}. {isArabic ? category.title.ar : category.title.en}
                  <span className="ms-2 text-sm font-normal text-gray-400">{isArabic ? category.title.en : category.title.ar}</span>
                </h3>
                <ul className="flex flex-col gap-1.5">
                  {category.reports.map((report) => (
                    <li key={report.key} className="flex items-center justify-between gap-2">
                      <Link to={report.key} className="text-blue-600 hover:underline">
                        {isArabic ? report.title.ar : report.title.en}
                        <span className="ms-2 text-xs text-gray-400">{isArabic ? report.title.en : report.title.ar}</span>
                      </Link>
                      <Badge variant="light" color="gray" size="sm" className="shrink-0">
                        {kindLabel[report.kind]}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )
      )}
    </AdminLayoutBox>
  );
}
