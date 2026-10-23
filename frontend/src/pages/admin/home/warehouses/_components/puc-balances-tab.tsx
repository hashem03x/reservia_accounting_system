import { Fragment, useEffect, useState } from "react";
import { useDebounce } from "use-debounce";
import { Alert, Select, Table, TextInput } from "@mantine/core";
import { DateInput } from "@mantine/dates";
import { useLanguage } from "@/context/LanguageContext";
import { useWarehouses } from "@/context/WarehousesContext";
import useDataHandler from "@/hooks/useDataHandler";
import useCategoryHelpers from "@/hooks/useCategoryHelpers";
import handleRequest from "@/utils/helpers/handle-request";
import { DataTable, DataTableContainer, dataTableHeadClassName } from "@/components/ui/data-table";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import EmptySection from "@/components/ui/sections/empty";
import { Project } from "@/types/project";
import { PucBalancesResult } from "@/types/puc-materials";

const money = (n: number | null | undefined) => (typeof n === "number" ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "-");
const qty = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 4 });
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : undefined);

/**
 * Warehouses -> PUC - Raw Materials (client requirement "Warehouses - Projectwise PUC Raw Materials
 * Balances"): per project and material, opening / purchased / transferred in / out / returned /
 * closing quantity and value - derived from the PUC allocation records, never a separate stored
 * balance - and, per project, the PUC - Raw Materials LEDGER balance beside it (the difference is
 * the value relieved by cost recognition when Sales Invoices are issued). Records with no project
 * are reported, never assigned to one. Quantity consumed is not recorded in Reservia, so the
 * quantity shown is the allocated quantity. Read-only (backend pucMaterialBalanceService.js).
 */
export default function PucBalancesTab() {
  const { language, translate, translations } = useLanguage();
  const { data: warehouses } = useWarehouses();
  const { getMainCategoryNameById, getBrandNameById } = useCategoryHelpers();

  const [project, setProject] = useState("");
  const [warehouse, setWarehouse] = useState("");
  const [dateFrom, setDateFrom] = useState<Date | null>(null);
  const [dateTo, setDateTo] = useState<Date | null>(null);
  const [keyword, setKeyword] = useState("");
  const [debouncedKeyword] = useDebounce(keyword, 350);

  const { privateRequest: projectsRequest, data: projects, setData: setProjects } = useDataHandler<Project[]>({ initialData: [] });
  useEffect(() => {
    projectsRequest({ url: "projects", params: { limit: 500 }, language })
      .then((res) => setProjects(res.data))
      .catch(() => setProjects([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { privateRequest, loading, setLoading, error, setError, data, setData } = useDataHandler<PucBalancesResult | null>({ initialData: null, initialLoading: true });
  function load() {
    handleRequest(language, setLoading, setError, async () => {
      const res = await privateRequest({
        url: "puc-transfers/balances",
        params: {
          ...(project ? { project } : {}),
          ...(warehouse ? { warehouse } : {}),
          ...(dateFrom ? { dateFrom: iso(dateFrom)! } : {}),
          ...(dateTo ? { dateTo: iso(dateTo)! } : {}),
          ...(debouncedKeyword.trim() ? { keyword: debouncedKeyword.trim() } : {}),
        },
        language,
      });
      setData(res.data);
    });
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, warehouse, dateFrom, dateTo, debouncedKeyword]);

  const warehouseName = (id: string) => warehouses.find((w) => w._id === id)?.name || "-";

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <Select
          label={translate("Project", "المشروع")}
          placeholder={translate("All projects", "كل المشروعات")}
          value={project || null}
          onChange={(v) => setProject(v || "")}
          data={projects.map((p) => ({ value: p._id, label: `${p.projectNumber}${p.name ? ` - ${p.name}` : ""}` }))}
          searchable
          clearable
        />
        <TextInput label={translate("Product", "المنتج")} placeholder={translate("Title, model or SKU", "العنوان أو الموديل أو الكود")} value={keyword} onChange={(e) => setKeyword(e.currentTarget.value)} />
        <Select
          label={translate("Warehouse", "المخزن")}
          placeholder={translate("All warehouses", "كل المخازن")}
          value={warehouse || null}
          onChange={(v) => setWarehouse(v || "")}
          data={warehouses.map((w) => ({ value: w._id, label: w.name }))}
          clearable
        />
        <DateInput label={translate("From", "من")} value={dateFrom} onChange={setDateFrom} clearable valueFormat="YYYY-MM-DD" />
        <DateInput label={translate("To", "إلى")} value={dateTo} onChange={setDateTo} clearable valueFormat="YYYY-MM-DD" minDate={dateFrom || undefined} />
      </div>

      {warehouse && (
        <p className="text-xs text-gray-500">
          {translate(
            "Warehouse filter: movements received into / transferred out of that warehouse only. Project-to-project reallocations have no warehouse and are not included.",
            "فلتر المخزن: الحركات الواردة إلى / المحولة من هذا المخزن فقط. لا تشمل التحويلات بين المشروعات.",
          )}
        </p>
      )}

      {loading ? (
        <LoadingSection message={translate("Loading PUC balances...", "جاري تحميل أرصدة مشروعات تحت التنفيذ...")} />
      ) : error ? (
        <ErrorSection errorTitle={translate("Error loading PUC balances", "خطأ في تحميل الأرصدة")} errorMessage={error} button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: load }} />
      ) : !data ? null : (
        <>
          {(data.dataQuality.ledgerLinesWithoutProject > 0 || data.dataQuality.allocationsWithMissingProject > 0) && (
            <Alert color="orange" variant="light" title={translate("Data to review", "بيانات تحتاج مراجعة")}>
              {data.dataQuality.ledgerLinesWithoutProject > 0 &&
                translate(
                  `${data.dataQuality.ledgerLinesWithoutProject} PUC - Raw Materials ledger line(s) have no project (net ${money(data.dataQuality.ledgerAmountWithoutProject)} ${translations.currency}; journal entries ${data.dataQuality.sampleEntryNumbers.join(", ")}). They cannot be shown projectwise - assign the project on those entries; nothing is assigned automatically.`,
                  `${data.dataQuality.ledgerLinesWithoutProject} سطر في حساب مشروعات تحت التنفيذ - مواد خام بدون مشروع (صافي ${money(data.dataQuality.ledgerAmountWithoutProject)}؛ القيود ${data.dataQuality.sampleEntryNumbers.join("، ")}). لا يمكن عرضها حسب المشروع - لا يتم تعيين أي مشروع تلقائيًا.`,
                )}{" "}
              {data.dataQuality.allocationsWithMissingProject > 0 &&
                translate(`${data.dataQuality.allocationsWithMissingProject} allocation record(s) point to a project that no longer exists.`, `${data.dataQuality.allocationsWithMissingProject} سجل تخصيص يشير إلى مشروع غير موجود.`)}
            </Alert>
          )}

          {data.rows.length === 0 ? (
            <EmptySection useDefaultImg message={translate("No PUC raw-material balances for these filters.", "لا توجد أرصدة للفلاتر المحددة.")} />
          ) : (
            <>
              <p className="text-xs text-gray-500">
                {translate(
                  "Quantity = allocated to the project's PUC (purchases + transfers in - transfers out - returns). Consumption is recorded in value only (cost recognition on Sales Invoices), shown as the difference to the PUC ledger.",
                  "الكمية = المخصصة لمشروعات تحت التنفيذ (مشتريات + تحويلات واردة - صادرة - مرتجعات). الاستهلاك يُسجل بالقيمة فقط (تحميل التكلفة عند فواتير المبيعات) ويظهر كفرق مع رصيد الحساب.",
                )}
              </p>
              <DataTableContainer maxHeight="70vh">
                <DataTable className="min-w-[1200px]" stickyHeader>
                  <Table.Thead className={`${dataTableHeadClassName} z-10`}>
                    <Table.Tr>
                      <Table.Th>{translate("Product", "المنتج")}</Table.Th>
                      <Table.Th>{translate("Category / Brand / Model", "الفئة / الماركة / الموديل")}</Table.Th>
                      <Table.Th>{translate("Warehouse(s)", "المخازن")}</Table.Th>
                      <Table.Th className="text-end">{translate("Opening qty", "رصيد أول")}</Table.Th>
                      <Table.Th className="text-end">{translate("Purchased", "مشتريات")}</Table.Th>
                      <Table.Th className="text-end">{translate("In", "وارد")}</Table.Th>
                      <Table.Th className="text-end">{translate("Out", "صادر")}</Table.Th>
                      <Table.Th className="text-end">{translate("Returned", "مرتجع")}</Table.Th>
                      <Table.Th className="text-end">{translate("Closing qty", "رصيد آخر")}</Table.Th>
                      <Table.Th className="text-end">{translate("Avg unit cost", "متوسط التكلفة")}</Table.Th>
                      <Table.Th className="text-end">{translate("Closing value", "القيمة")}</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {data.projects.map((summary) => (
                      <Fragment key={summary.project._id}>
                        <Table.Tr className="bg-gray-50 font-semibold dark:bg-gray-800">
                          <Table.Td colSpan={8}>
                            {summary.project.projectNumber || translate("(project missing)", "(مشروع غير موجود)")}
                            {summary.project.name ? ` - ${summary.project.name}` : ""}
                            <span className="ms-3 text-xs font-normal text-gray-500">
                              {translate("PUC ledger", "رصيد الحساب")}: {money(summary.ledger.closing)} ({translate("debit", "مدين")} {money(summary.ledger.debit)} / {translate("credit", "دائن")} {money(summary.ledger.credit)})
                              {summary.differenceToLedger !== null && (
                                <>
                                  {" "}
                                  - {translate("difference to materials", "الفرق عن المواد")}: {money(summary.differenceToLedger)}
                                </>
                              )}
                            </span>
                          </Table.Td>
                          <Table.Td colSpan={2} className="text-end text-xs text-gray-500">
                            {translate(`${summary.materials} material(s)`, `${summary.materials} مادة`)}
                          </Table.Td>
                          <Table.Td className="text-end tabular-nums">{money(summary.closingValue)}</Table.Td>
                        </Table.Tr>
                        {data.rows
                          .filter((r) => r.project._id === summary.project._id)
                          .map((r) => (
                            <Table.Tr key={`${r.project._id}-${r.product?._id}`}>
                              <Table.Td>{r.product ? translate(r.product.title.en, r.product.title.ar) : "-"}</Table.Td>
                              <Table.Td>
                                {[r.product?.category ? getMainCategoryNameById(r.product.category) : null, r.product?.brand ? getBrandNameById(r.product.brand) : null, r.product?.model].filter(Boolean).join(" / ") || "-"}
                              </Table.Td>
                              <Table.Td>{r.warehouses.map(warehouseName).join(", ") || "-"}</Table.Td>
                              <Table.Td className="text-end tabular-nums">{qty(r.openingQuantity)}</Table.Td>
                              <Table.Td className="text-end tabular-nums">{qty(r.purchasedQuantity)}</Table.Td>
                              <Table.Td className="text-end tabular-nums">{qty(r.transferredInQuantity)}</Table.Td>
                              <Table.Td className="text-end tabular-nums">{qty(r.transferredOutQuantity)}</Table.Td>
                              <Table.Td className="text-end tabular-nums">{qty(r.returnedQuantity)}</Table.Td>
                              <Table.Td className="text-end font-semibold tabular-nums">{qty(r.closingQuantity)}</Table.Td>
                              <Table.Td className="text-end tabular-nums">{money(r.averageUnitCost)}</Table.Td>
                              <Table.Td className="text-end tabular-nums">{money(r.closingValue)}</Table.Td>
                            </Table.Tr>
                          ))}
                      </Fragment>
                    ))}
                  </Table.Tbody>
                  <Table.Tfoot className="border-t-2 bg-gray-50 font-bold dark:bg-gray-800">
                    <Table.Tr>
                      <Table.Td colSpan={10}>
                        {translate("Total", "الإجمالي")} <span className="text-xs font-normal text-gray-500">({translate("PUC ledger", "رصيد الحساب")}: {money(data.totals.ledgerClosing)})</span>
                      </Table.Td>
                      <Table.Td className="text-end tabular-nums">{money(data.totals.closingValue)}</Table.Td>
                    </Table.Tr>
                  </Table.Tfoot>
                </DataTable>
              </DataTableContainer>
            </>
          )}
        </>
      )}
    </div>
  );
}
