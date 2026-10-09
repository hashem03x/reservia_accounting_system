import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useDisclosure } from "@mantine/hooks";
import { Alert, Badge, Button } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import useHasPermission from "@/hooks/useHasPermission";
import handleRequest from "@/utils/helpers/handle-request";
import paths from "@/utils/constants/paths";
import resources from "@/utils/constants/resources";
import actions from "@/utils/constants/actions";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import ErrorAlert from "@/components/ui/error-alert";
import { solidIcons } from "@/components/icons";
import { DisclosureNote, ReportCatalog, ReportCatalogEntry, ReportResult, ReportRow } from "@/types/accounting-report";
import ReportFilters, { FilterValues } from "../_components/report-filters";
import ReportTable from "../_components/report-table";
import DisclosureNoteModal from "../_components/disclosure-note-modal";
import { printReport } from "../_components/print-report";
import { formatMoney, todayUtc } from "../_components/format";

const defaultsFor = (entry: ReportCatalogEntry): FilterValues => {
  const today = todayUtc();
  return {
    ...(entry.filters.includes("period") ? { from: `${today.slice(0, 4)}-01-01`, to: today } : {}),
    ...(entry.filters.includes("asOf") ? { asOf: today } : {}),
  };
};
const clean = (values: FilterValues) => Object.fromEntries(Object.entries(values).filter(([, v]) => v !== "" && v !== undefined && v !== null));

export default function AccountingReport() {
  const { key } = useParams();
  const { language, translate, translations } = useLanguage();
  const isArabic = language === "ar-EG";
  const [searchParams, setSearchParams] = useSearchParams();
  const canEditNotes = useHasPermission(resources.reports, actions.create);

  // The catalog tells which filters this report has.
  const { privateRequest: loadCatalog, data: catalog, setData: setCatalog, error: catalogError, setError: setCatalogError, loading: catalogLoading, setLoading: setCatalogLoading } = useDataHandler<ReportCatalog | null>({ initialData: null, initialLoading: true });
  useEffect(() => {
    handleRequest(language, setCatalogLoading, setCatalogError, async () => {
      const res = await loadCatalog({ url: "accounting-reports", language });
      setCatalog(res.data);
    });
  }, []);
  const entry = useMemo(() => catalog?.categories.flatMap((c) => c.reports).find((r) => r.key === key) || null, [catalog, key]);

  const [values, setValues] = useState<FilterValues>({});
  const [applied, setApplied] = useState<FilterValues | null>(null);
  const [page, setPage] = useState(1);
  useEffect(() => {
    if (!entry) return;
    const fromUrl = Object.fromEntries(searchParams.entries());
    const initial = { ...defaultsFor(entry), ...fromUrl };
    delete initial.page;
    setValues(initial);
    setApplied(initial);
    setPage(Number(fromUrl.page) || 1);
  }, [entry?.key]);

  const { privateRequest, loading, setLoading, error, setError, data: report, setData: setReport } = useDataHandler<ReportResult | null>({ initialData: null });

  function load() {
    if (!applied || !entry) return () => undefined;
    const controller = new AbortController();
    const canceled = { current: false };
    handleRequest(
      language,
      setLoading,
      setError,
      async () => {
        const res = await privateRequest({ url: `accounting-reports/${entry.key}`, params: { ...clean(applied), page: String(page) }, signal: controller.signal, language });
        setReport(res.data);
      },
      canceled,
    );
    return () => {
      controller.abort();
      canceled.current = true;
    };
  }
  useEffect(() => {
    if (!applied) return;
    setSearchParams({ ...clean(applied), ...(page > 1 ? { page: String(page) } : {}) }, { replace: true });
    return load();
  }, [applied, page]);

  const title = entry ? (isArabic ? entry.title.ar : entry.title.en) : translations.pages.financialReports;
  useDocumentTitle(`${title} | ${translations.adminPanel}`);

  // ---------------- export / print
  const [exporting, setExporting] = useState(false);
  const [actionError, setActionError] = useState("");
  async function handleExport() {
    if (!entry || !applied) return;
    setExporting(true);
    setActionError("");
    try {
      await privateRequest({ url: `accounting-reports/${entry.key}/export`, params: { ...clean(applied), lang: isArabic ? "ar" : "en" }, download: true, filename: `${entry.key}.xlsx`, language });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  }
  const filterLines = (r: ReportResult) => [
    `${translate("Category", "المجموعة")}: ${isArabic ? r.categoryTitle.ar : r.categoryTitle.en}`,
    ...(r.period ? [`${translate("Period", "الفترة")}: ${r.period.from} → ${r.period.to}`] : []),
    ...(r.asOf ? [`${translate("As of", "في تاريخ")}: ${r.asOf}`] : []),
    ...Object.entries(r.filters)
      .filter(([k]) => !["from", "to", "asOf"].includes(k))
      .map(([k, v]) => `${k}: ${v}`),
    `${translate("Generated", "تاريخ الإنشاء")}: ${r.generatedAt.replace("T", " ").slice(0, 16)} UTC`,
    `${translate("Currency", "العملة")}: ${r.currency}`,
  ];
  async function handlePrint() {
    if (!entry || !applied) return;
    setActionError("");
    try {
      const res = await privateRequest({ url: `accounting-reports/${entry.key}`, params: { ...clean(applied), all: "true" }, language });
      if (!printReport(res.data, isArabic, filterLines(res.data))) setActionError(translate("Allow pop-ups for this site to print.", "اسمح بالنوافذ المنبثقة لهذا الموقع للطباعة."));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }

  // ---------------- disclosure notes (manual section)
  const [noteModalOpened, { open: openNoteModal, close: closeNoteModal }] = useDisclosure();
  const [editingNote, setEditingNote] = useState<DisclosureNote | null>(null);
  const { privateRequest: notesRequest, data: notes, setData: setNotes } = useDataHandler<DisclosureNote[]>({ initialData: [] });
  useEffect(() => {
    if (entry?.key === "disclosure-notes") {
      notesRequest({ url: "accounting-reports/notes", language })
        .then((res) => setNotes(res.data || []))
        .catch(() => setNotes([]));
    }
  }, [entry?.key, report]);
  async function deleteNote(id: string) {
    if (!confirm(translate("Delete this note?", "حذف هذا الإيضاح؟"))) return;
    try {
      await privateRequest({ url: `accounting-reports/notes/${id}`, method: "DELETE", language });
      load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }

  if (catalogLoading) return <LoadingSection message={translate("Loading...", "جاري التحميل...")} />;
  if (catalogError) return <ErrorSection errorTitle={translate("Error loading reports", "خطأ في تحميل التقارير")} errorMessage={catalogError} />;
  if (!entry) return <ErrorSection errorTitle={translate("Report not found", "التقرير غير موجود")} errorMessage={String(key)} />;

  const summaryValue = (s: ReportResult["summary"][number]) => (s.value === null ? translate("n/a", "غير متاح") : s.type === "money" ? formatMoney(s.value) : s.type === "percent" ? `${s.value}%` : s.value.toLocaleString("en-US"));

  return (
    <AdminLayoutBox
      header={{
        title,
        subTitle: isArabic ? entry.title.en : entry.title.ar,
        backLink: `/${paths.admin}/${paths.financialReports}`,
        sideElements: (
          <div className="flex flex-wrap gap-2">
            <Button variant="light" color="green" leftSection={exporting ? <solidIcons.Spinner className="animate-spin" /> : <solidIcons.Download />} disabled={exporting || !report} onClick={handleExport}>
              {translate("Export Excel", "تصدير Excel")}
            </Button>
            <Button variant="light" color="gray" disabled={!report} onClick={handlePrint}>
              {translate("Print / PDF", "طباعة / PDF")}
            </Button>
          </div>
        ),
      }}
    >
      <form
        className="mb-4 flex flex-col gap-3 rounded-lg border border-gray-100 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setApplied({ ...values });
        }}
      >
        <ReportFilters reportKey={entry.key} filters={entry.filters} values={values} onChange={setValues} />
        <div className="flex justify-end">
          <Button type="submit" loading={loading}>
            {translate("Run Report", "عرض التقرير")}
          </Button>
        </div>
      </form>

      {actionError && <ErrorAlert error={actionError} />}

      {loading && !report ? (
        <LoadingSection message={translate("Preparing the report...", "جاري إعداد التقرير...")} />
      ) : error ? (
        <ErrorSection errorTitle={translate("Error generating the report", "خطأ في إعداد التقرير")} errorMessage={error} button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: load }} />
      ) : (
        report && (
          <div className={`flex flex-col gap-5 ${loading ? "opacity-60" : ""}`}>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
              {filterLines(report).map((line) => (
                <span key={line}>{line}</span>
              ))}
            </div>

            {report.summary.length > 0 && (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                {report.summary.map((s) => (
                  <div key={s.key} className="rounded-lg border border-gray-100 p-3">
                    <p className="text-xs text-gray-500">{isArabic ? s.label.ar : s.label.en}</p>
                    <p className={`mt-1 text-base font-semibold tabular-nums ${typeof s.value === "number" && s.value < 0 && s.type === "money" ? "text-red-600" : ""}`}>{summaryValue(s)}</p>
                  </div>
                ))}
              </div>
            )}

            {report.checks.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {report.checks.map((c, i) => (
                  <Badge key={i} color={c.ok ? "green" : "red"} variant="light" size="lg" className="normal-case" title={c.detail || undefined}>
                    {c.ok ? "✓" : "✗"} {isArabic ? c.label.ar : c.label.en}
                    {!c.ok && c.detail ? ` (${c.detail})` : ""}
                  </Badge>
                ))}
              </div>
            )}

            {report.chart && report.sections[0] && <BarSummary report={report} isArabic={isArabic} />}

            {report.sections.map((section) => (
              <section key={section.key} className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4>{isArabic ? section.title.ar : section.title.en}</h4>
                  {section.manual && canEditNotes && (
                    <Button
                      size="xs"
                      variant="light"
                      onClick={() => {
                        setEditingNote(null);
                        openNoteModal();
                      }}
                    >
                      {translate("Add Note", "إضافة إيضاح")}
                    </Button>
                  )}
                </div>
                <ReportTable
                  section={section}
                  onPageChange={setPage}
                  renderActions={
                    section.manual && canEditNotes
                      ? (row: ReportRow) => (
                          <div className="flex gap-1">
                            <Button
                              size="compact-xs"
                              variant="subtle"
                              onClick={() => {
                                setEditingNote(notes.find((n) => n._id === row._noteId) || null);
                                openNoteModal();
                              }}
                            >
                              {translate("Edit", "تعديل")}
                            </Button>
                            <Button size="compact-xs" variant="subtle" color="red" onClick={() => row._noteId && deleteNote(row._noteId)}>
                              {translate("Delete", "حذف")}
                            </Button>
                          </div>
                        )
                      : undefined
                  }
                />
              </section>
            ))}

            {report.notes.length > 0 && (
              <Alert color="blue" variant="light" title={translate("Basis and limitations", "أساس الإعداد والقيود")}>
                <div className="flex flex-col gap-2 text-sm">
                  {report.notes.map((n, i) => (
                    <p key={i}>{isArabic ? n.ar : n.en}</p>
                  ))}
                </div>
              </Alert>
            )}
          </div>
        )
      )}

      <DisclosureNoteModal opened={noteModalOpened} close={closeNoteModal} note={editingNote} onSaved={load} />
    </AdminLayoutBox>
  );
}

// A compact bar summary for the count reports (projects by status / sector).
function BarSummary({ report, isArabic }: { report: ReportResult; isArabic: boolean }) {
  const { labelKey, valueKey } = report.chart!;
  const rows = report.sections[0].rows.filter((r) => typeof r[valueKey] === "number");
  const max = Math.max(1, ...rows.map((r) => r[valueKey] as number));
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-gray-100 p-3">
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-2 text-sm">
          <span className="w-40 shrink-0 truncate">{String((isArabic ? r[`${labelKey}Ar`] : null) ?? r[labelKey])}</span>
          <div className="h-3 flex-1 rounded bg-gray-100">
            <div className="h-3 rounded bg-blue-500" style={{ width: `${((r[valueKey] as number) / max) * 100}%` }} />
          </div>
          <span className="w-10 shrink-0 text-end tabular-nums">{r[valueKey] as number}</span>
        </div>
      ))}
    </div>
  );
}
