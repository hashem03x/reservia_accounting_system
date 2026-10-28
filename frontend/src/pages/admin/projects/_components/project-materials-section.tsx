import { Fragment, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ActionIcon, Alert, Badge, Table, Tooltip } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import useCategoryHelpers from "@/hooks/useCategoryHelpers";
import handleRequest from "@/utils/helpers/handle-request";
import { formatDate } from "@/utils/helpers/date-formaters";
import paths from "@/utils/constants/paths";
import { DataTable, DataTableContainer, dataTableHeadClassName } from "@/components/ui/data-table";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import { solidIcons } from "@/components/icons";
import { ProjectMaterialBreakdown } from "@/types/puc-materials";

const money = (n: number | null | undefined) => (typeof n === "number" ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "-");
const qty = (n: number | null | undefined) => (typeof n === "number" ? n.toLocaleString(undefined, { maximumFractionDigits: 4 }) : "-");

/**
 * Projects -> Raw Materials (client requirement "Projects - Raw Materials Breakdown, BOQ Price, and
 * PO Cost"): item by item, the BOQ unit price (revenue side, from the project's BOQ), the ACTUAL
 * purchase unit cost (from the project's Purchase Invoice lines - each source invoice listed), the
 * committed Purchase Order cost shown separately, and the contribution
 * (BOQ unit price - unit cost) x BOQ quantity. Missing data is shown as missing, never as zero.
 * An analysis figure only - it is not recognized accounting revenue and posts nothing
 * (backend services/inventory/pucMaterialBalanceService.js#getProjectMaterialBreakdown).
 */
export default function ProjectMaterialsSection({ projectId, reloadKey }: { projectId: string; reloadKey?: unknown }) {
  const { language, translate, translations } = useLanguage();
  const { getMainCategoryNameById, getBrandNameById } = useCategoryHelpers();
  const { privateRequest, loading, setLoading, error, setError, data, setData } = useDataHandler<ProjectMaterialBreakdown | null>({ initialData: null, initialLoading: true });
  const [open, setOpen] = useState<string | null>(null);

  function load() {
    handleRequest(language, setLoading, setError, async () => {
      const res = await privateRequest({ url: `puc-transfers/project/${projectId}/materials`, language });
      setData(res.data);
    });
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, reloadKey]);

  const statusBadge = (status: string) => {
    const map: Record<string, [string, string, string]> = {
      ok: ["green", "Calculated", "محسوب"],
      missing_cost: ["orange", "No purchase cost yet", "لا توجد تكلفة شراء بعد"],
      missing_boq: ["gray", "Not in the BOQ", "غير موجود في جدول الكميات"],
      currency_not_configured: ["red", "BOQ currency not configured", "عملة جدول الكميات غير معرفة"],
    };
    const [color, en, ar] = map[status] || ["gray", status, status];
    return (
      <Badge size="sm" variant="light" color={color}>
        {translate(en, ar)}
      </Badge>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <h4>{translate("Raw Materials - BOQ Price vs Purchase Cost", "المواد الخام - سعر جدول الكميات مقابل تكلفة الشراء")}</h4>
      {loading ? (
        <LoadingSection message={translate("Loading raw materials...", "جاري تحميل المواد الخام...")} />
      ) : error ? (
        <ErrorSection errorTitle={translate("Error loading raw materials", "خطأ في تحميل المواد الخام")} errorMessage={error} button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: load }} />
      ) : !data || data.materials.length === 0 ? (
        <p className="text-sm text-gray-400">{translate("No BOQ lines, purchases or Purchase Orders for this project yet.", "لا توجد بنود جدول كميات أو مشتريات أو أوامر شراء لهذا المشروع بعد.")}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Card label={translate("BOQ value (EGP)", "قيمة جدول الكميات (جنيه)")} value={money(data.totals.boqValue)} />
            <Card label={translate("Purchased (actual)", "المشتريات (فعلي)")} value={money(data.totals.purchasedValue)} />
            <Card
              label={translate("Contribution (BOQ price - cost) x BOQ qty", "المساهمة (سعر جدول الكميات - التكلفة) × الكمية")}
              value={money(data.totals.contribution)}
              hint={translate(`${data.totals.contributionLines} item(s) calculated`, `${data.totals.contributionLines} بند محسوب`)}
            />
            <Card
              label={translate("PUC - Raw Materials balance", "رصيد مشروعات تحت التنفيذ - مواد خام")}
              value={money(data.ledger.closing)}
              hint={data.account ? `${data.account.code}` : undefined}
            />
          </div>
          {(data.totals.missingCostLines > 0 || data.totals.missingBoqLines > 0 || data.totals.currencyErrorLines > 0) && (
            <Alert color="orange" variant="light" p="xs">
              {translate(
                `Not included in the contribution: ${data.totals.missingCostLines} item(s) with no purchase cost yet, ${data.totals.missingBoqLines} purchased item(s) not in the BOQ, ${data.totals.currencyErrorLines} with an unconfigured BOQ currency. Missing values are never counted as zero.`,
                `غير مشمول في المساهمة: ${data.totals.missingCostLines} بند بدون تكلفة شراء، ${data.totals.missingBoqLines} بند مشترى غير موجود في جدول الكميات، ${data.totals.currencyErrorLines} بعملة غير معرفة. القيم الناقصة لا تُحسب صفرًا.`,
              )}
            </Alert>
          )}
          <p className="text-xs text-gray-500">
            {translate(
              "Unit cost = actual purchase cost from the project's Purchase Invoices (weighted average). Committed cost (open Purchase Orders) is shown separately. Contribution is a price-minus-cost analysis, not recognized revenue.",
              "تكلفة الوحدة = تكلفة الشراء الفعلية من فواتير مشتريات المشروع (متوسط مرجح). التكلفة الملتزم بها (أوامر الشراء المفتوحة) معروضة منفصلة. المساهمة تحليل سعر ناقص تكلفة وليست إيرادًا معترفًا به.",
            )}
          </p>
          <DataTableContainer maxHeight="70vh">
            <DataTable className="min-w-[1250px]" stickyHeader>
              <Table.Thead className={`${dataTableHeadClassName} z-10`}>
                <Table.Tr>
                  <Table.Th />
                  <Table.Th>{translate("Product", "المنتج")}</Table.Th>
                  <Table.Th>{translate("Category / Brand / Model", "الفئة / الماركة / الموديل")}</Table.Th>
                  <Table.Th className="text-end">{translate("BOQ qty", "كمية جدول الكميات")}</Table.Th>
                  <Table.Th className="text-end">{translate("BOQ unit price", "سعر الوحدة")}</Table.Th>
                  <Table.Th className="text-end">{translate("Purchased qty", "الكمية المشتراة")}</Table.Th>
                  <Table.Th className="text-end">{translate("Unit cost (actual)", "تكلفة الوحدة (فعلية)")}</Table.Th>
                  <Table.Th className="text-end">{translate("Committed unit cost", "تكلفة ملتزم بها")}</Table.Th>
                  <Table.Th className="text-end">{translate("Unit difference", "فرق الوحدة")}</Table.Th>
                  <Table.Th className="text-end">{translate("Contribution", "المساهمة")}</Table.Th>
                  <Table.Th>{translate("Status", "الحالة")}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data.materials.map((m) => {
                  const id = m.product?._id || "";
                  return (
                    <Fragment key={id}>
                      <Table.Tr>
                        <Table.Td>
                          {m.sources.length > 0 && (
                            <Tooltip label={translate("Source documents", "المستندات المصدر")}>
                              <ActionIcon size="sm" variant="subtle" aria-label={translate("Source documents", "المستندات المصدر")} onClick={() => setOpen(open === id ? null : id)}>
                                {open === id ? <solidIcons.ArrowUp size={12} /> : <solidIcons.ArrowDown size={12} />}
                              </ActionIcon>
                            </Tooltip>
                          )}
                        </Table.Td>
                        <Table.Td className="font-semibold">{m.product ? translate(m.product.title.en, m.product.title.ar) : "-"}</Table.Td>
                        <Table.Td>
                          {[m.product?.category ? getMainCategoryNameById(m.product.category) : null, m.product?.brand ? getBrandNameById(m.product.brand) : null, m.product?.model].filter(Boolean).join(" / ") || "-"}
                        </Table.Td>
                        <Table.Td className="text-end tabular-nums">{m.boq ? `${qty(m.boq.quantity)} ${m.boq.unit || ""}` : "-"}</Table.Td>
                        <Table.Td className="text-end tabular-nums">
                          {m.boq ? (
                            <>
                              {money(m.boq.unitPriceEgp)} {translations.currency}
                              {m.boq.currency !== "EGP" && (
                                <div className="text-xs text-gray-500">
                                  {money(m.boq.unitPrice)} {m.boq.currency}
                                </div>
                              )}
                            </>
                          ) : (
                            "-"
                          )}
                        </Table.Td>
                        <Table.Td className="text-end tabular-nums">{qty(m.purchasedQuantity)}</Table.Td>
                        <Table.Td className="text-end tabular-nums">{money(m.purchaseUnitCost)}</Table.Td>
                        <Table.Td className="text-end tabular-nums text-gray-500">{money(m.committedUnitCost)}</Table.Td>
                        <Table.Td className={`text-end tabular-nums ${(m.contribution.unitDifference ?? 0) < 0 ? "text-red-600" : ""}`}>{money(m.contribution.unitDifference)}</Table.Td>
                        <Table.Td className={`text-end font-semibold tabular-nums ${(m.contribution.total ?? 0) < 0 ? "text-red-600" : ""}`}>{money(m.contribution.total)}</Table.Td>
                        <Table.Td>
                          <div className="flex flex-wrap gap-1">
                            {statusBadge(m.contribution.status)}
                            {m.contribution.unitMismatch && (
                              <Badge size="sm" variant="light" color="yellow" title={translate("The BOQ unit differs from the Purchase Order unit - check the quantities are comparable.", "وحدة جدول الكميات تختلف عن وحدة أمر الشراء.")}>
                                {translate("Unit differs", "وحدة مختلفة")}
                              </Badge>
                            )}
                          </div>
                        </Table.Td>
                      </Table.Tr>
                      {open === id && (
                        <Table.Tr>
                          <Table.Td colSpan={11} className="bg-gray-50 dark:bg-gray-800">
                            <div className="flex flex-col gap-1 text-xs">
                              {m.sources.map((s, i) => (
                                <div key={i} className="flex flex-wrap gap-x-4">
                                  <span>{formatDate(s.date, language)}</span>
                                  <span>{({ purchase: translate("Purchase", "شراء"), transfer_in: translate("Transfer in", "تحويل وارد"), transfer_out: translate("Transfer out", "تحويل صادر"), return: translate("Return", "مرتجع") } as Record<string, string>)[s.kind]}</span>
                                  {s.invoice ? (
                                    <Link className="text-blue-600 hover:underline" to={`/${paths.admin}/${paths.home}/${paths.purchaseOrders}/${s.invoice._id}`}>
                                      {translate("Invoice", "فاتورة")} {s.invoice.code}
                                    </Link>
                                  ) : null}
                                  {s.invoice?.vendor && <span>{s.invoice.vendor.name}</span>}
                                  <span className="tabular-nums">
                                    {qty(s.quantity)} x {money(s.unitCost)} = {money(s.amount)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </Table.Td>
                        </Table.Tr>
                      )}
                    </Fragment>
                  );
                })}
              </Table.Tbody>
            </DataTable>
          </DataTableContainer>
        </>
      )}
    </div>
  );
}

function Card({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
      <span className="text-xs text-gray-500">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
      {hint && <span className="text-xs text-gray-400">{hint}</span>}
    </div>
  );
}
