import { useEffect, useState } from "react";
import dayjs from "dayjs";
import { Alert, Badge, Button, Menu, NumberInput, Select, Table, Tooltip } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import { useSystemAccess } from "@/context/SystemAccessContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { formatAmount } from "@/utils/helpers/format-amount";
import { DataTable, DataTableContainer, dataTableHeadClassName } from "@/components/ui/data-table";
import { solidIcons } from "@/components/icons";
import { notifyError } from "@/utils/helpers/notifiers";
import errorMessage from "@/utils/helpers/error-message";
import { BoqLine, CommercialProject, CommercialRevision, CommercialRole } from "@/types/commercial";
import { canEdit, projectTabAccess } from "../../../_shared/dealEnginePermissions";
import CreatePrModal from "./create-pr-modal";
import { notifyRecalculated } from "../../../_shared/recalcNotice";

// Feature 2/3 - who may select/change a BOQ line's vendor (mirrors backend
// revisionService.js#BOQ_VENDOR_ROLES).
const BOQ_VENDOR_ROLES = ["md", "commercial_director", "procurement"];
// Go-live Developer Pack 5.4: who may Create PR from a BOQ line - a WIDER, separate list (mirrors
// backend createPrService.js#BOQ_VENDOR_ROLES, which gained bdm/sales for this action specifically
// while the vendor-select list above did not change). These two backend lists share a name but have
// diverged - do not collapse them back into one constant here.
const BOQ_CREATE_PR_ROLES = ["md", "commercial_director", "procurement", "bdm", "sales"];

// Every BOQ line distinguishes automatic vs. manually-overridden values (source badge) - an
// override is applied on top of the live recalculation without discarding the auto-calculated
// baseline (shown via the "auto: X" tooltip), per the project's own explicit rule.
export default function BoqTab({ project, revision, onChanged }: { project: CommercialProject; revision: CommercialRevision; onChanged: () => void }) {
  const { translate, language } = useLanguage();
  const { systems } = useSystemAccess();
  const role = (systems?.COMMERCIAL?.role || "") as CommercialRole | "";
  const canSetVendor = BOQ_VENDOR_ROLES.includes(role);
  const canCreatePr = BOQ_CREATE_PR_ROLES.includes(role);
  // Go-live audit: qty/unit price overrides need EDIT-level BOQ access (backend
  // assertEngineeringInputWriteAllowed/boqLines row) - Sales and Procurement are 'view' only and
  // would always get a 403 on save, so the inputs below must not invite them to try.
  const canEditBoq = canEdit(projectTabAccess(role ? [role as CommercialRole] : [], "boqLines"));
  const [overrides, setOverrides] = useState<Record<string, { qty?: number; unitPrice?: number }>>({});
  const { privateRequest, loading, setLoading, error, setError } = useDataHandler<null>({ initialData: null });

  // Feature 2 - the Approved/Conditional supplier list to pick from (small, fetched once - no
  // keyword-search endpoint exists for Suppliers, same as requisition-select's own precedent).
  const [suppliers, setSuppliers] = useState<{ _id: string; code: string; legalName: string; status: string }[]>([]);
  const [vendorBusy, setVendorBusy] = useState<string | null>(null);
  const [prLine, setPrLine] = useState<BoqLine | null>(null);
  useEffect(() => {
    if (!canSetVendor && !canCreatePr) return;
    privateRequest({ url: "commercial/suppliers", language })
      .then((res) => setSuppliers((res.data || []).filter((s: { status: string }) => ["Approved", "Conditional"].includes(s.status))))
      .catch(() => setSuppliers([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSetVendor, canCreatePr]);

  function setLineVendor(component: string, supplierId: string | null) {
    setVendorBusy(component);
    privateRequest({
      url: `commercial/revisions/${revision._id}/boq-lines/${encodeURIComponent(component)}/vendor`,
      method: "PATCH",
      data: { supplierId },
      language,
    })
      .then(onChanged)
      .catch((e: { message?: string }) => notifyError({ language, message: e?.message || translate("Could not update the vendor.", "تعذر تحديث المورد.") }))
      .finally(() => setVendorBusy(null));
  }

  function setOverride(component: string, field: "qty" | "unitPrice", value: number) {
    setOverrides((prev) => ({ ...prev, [component]: { ...prev[component], [field]: value } }));
  }

  // One write path for every BOQ action: the revision is recalculated from its stored engineering
  // input with the LATEST Price Book / supplier prices and Rates matrix, saved, and reloaded. Saved
  // overrides are kept by the server (revisionService.js#carriedOverrides); `null` resets one.
  const [busy, setBusy] = useState<string | null>(null);
  function recalculate(manualOverrides: Record<string, { qty?: number; unitPrice?: number } | null> | undefined, key: string) {
    setBusy(key);
    handleRequest(language, setLoading, setError, async () => {
      try {
        const res = await privateRequest({
          url: `commercial/revisions/${revision._id}`,
          method: "PATCH",
          data: { engineeringInput: revision.engineeringInput, ...(manualOverrides ? { manualOverrides } : {}) },
          language,
        });
        setOverrides({});
        notifyRecalculated({ language, translate, response: res, currency: project.currency });
        onChanged();
      } finally {
        setBusy(null);
      }
    });
  }
  const handleSave = () => recalculate(overrides, "save");

  // Export of the STORED revision (generated server-side from MongoDB, never from this table's state).
  const [exporting, setExporting] = useState<"xlsx" | "csv" | null>(null);
  async function exportBoq(format: "xlsx" | "csv") {
    setExporting(format);
    try {
      await privateRequest({
        url: `commercial/revisions/${revision._id}/boq-export`,
        params: { format },
        download: true,
        filename: `BOQ_${project.projectCode}_Rev${revision.revisionNumber}.${format}`,
        language,
      });
    } catch (e) {
      notifyError({ language, message: errorMessage(e) });
    } finally {
      setExporting(null);
    }
  }
  const hasLines = revision.boqLines.length > 0;
  const isLocked = !revision.isCurrent;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2" data-testid="boq-toolbar">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold">{translate(`Revision ${revision.revisionNumber}`, `النسخة ${revision.revisionNumber}`)}</span>
          <Badge size="sm" variant="light" color={revision.isCurrent ? "teal" : "gray"}>
            {revision.isCurrent ? translate("Current", "الحالية") : translate("Superseded", "سابقة")}
          </Badge>
          {revision.status === "Draft" && (
            <Badge size="sm" variant="light" color="orange">
              {translate("Draft - recalculate", "مسودة - أعد الحساب")}
            </Badge>
          )}
          <span className="text-xs text-gray-500" data-testid="boq-calculated-at">
            {translate("Calculated", "تم الحساب")} {dayjs(revision.lastCalculatedAt || revision.updatedAt).format("DD MMM YYYY HH:mm")}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canEditBoq && !isLocked && (
            <Tooltip
              label={translate(
                "Re-runs this revision with its engineering inputs and the latest Price Book, supplier prices and rates, keeps your overrides, and saves it.",
                "يعيد حساب هذه النسخة بمدخلاتها الفنية وأحدث الأسعار وأسعار الموردين والمعدلات مع الإبقاء على تعديلاتك ويحفظها."
              )}
              multiline
              w={300}
            >
              <Button size="xs" color="teal" loading={busy === "recalc"} disabled={!!busy} onClick={() => recalculate(undefined, "recalc")} data-testid="boq-recalculate">
                {translate("Recalculate BOQ", "إعادة حساب جدول الكميات")}
              </Button>
            </Tooltip>
          )}
          <Menu position="bottom-end" withinPortal>
            <Menu.Target>
              <Button size="xs" variant="default" loading={!!exporting} disabled={!hasLines} data-testid="boq-export">
                {translate("Export", "تصدير")}
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item onClick={() => exportBoq("xlsx")} data-testid="boq-export-xlsx">
                {translate("Export Excel (.xlsx)", "تصدير Excel (.xlsx)")}
              </Menu.Item>
              <Menu.Item onClick={() => exportBoq("csv")} data-testid="boq-export-csv">
                {translate("Export CSV (.csv)", "تصدير CSV (.csv)")}
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </div>
      </div>
      {revision.priceChangedSinceCalculation && (
        // Deal Engine C24 - a price this revision uses changed (supplier price list, supplier approval,
        // Materials edit, workbook import). Nothing recalculates on its own: the figures below stay the
        // stored ones - flagged outdated - until someone recalculates.
        <Alert color="orange" variant="light" title={translate("Prices changed since this calculation - the figures below are outdated", "تغيّرت الأسعار منذ هذا الحساب - الأرقام أدناه قديمة")} data-testid="price-changed-banner">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              {translate("Changed", "تغيّر")}: {(revision.priceChangedItems || []).join(", ")}.
            </span>
            {canEditBoq && !isLocked && (
              <Button size="xs" color="orange" loading={busy === "recalc"} disabled={!!busy} onClick={() => recalculate(undefined, "recalc")}>
                {translate("Recalculate BOQ now", "أعد حساب جدول الكميات الآن")}
              </Button>
            )}
          </div>
        </Alert>
      )}
      {!hasLines && (
        <Alert color="gray" variant="light">
          {translate("This revision has no BOQ lines yet - calculate it on the Engineering Input tab.", "لا توجد بنود في هذه النسخة بعد - احسبها من تبويب المدخلات الفنية.")}
        </Alert>
      )}
      <DataTableContainer>
        <DataTable className="min-w-[900px]">
          <Table.Thead className={dataTableHeadClassName}>
            <Table.Tr>
              <Table.Th>{translate("Component", "البند")}</Table.Th>
              <Table.Th>{translate("Description", "الوصف")}</Table.Th>
              <Table.Th>{translate("Unit", "الوحدة")}</Table.Th>
              <Table.Th className="text-right">{translate("Qty", "الكمية")}</Table.Th>
              <Table.Th className="text-right">{translate("Unit Price", "سعر الوحدة")}</Table.Th>
              <Table.Th className="text-right">{translate("Total", "الإجمالي")}</Table.Th>
              <Table.Th>{translate("Source", "المصدر")}</Table.Th>
              <Table.Th>{translate("Vendor", "المورد")}</Table.Th>
              <Table.Th>{translate("Procurement", "التوريد")}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {revision.boqLines.map((line, i) => (
              <Table.Tr key={i}>
                <Table.Td className="font-medium">
                  {line.component}
                  {line.flag && (
                    <Tooltip label={line.flag}>
                      <solidIcons.ExclamationCircle className="ms-1 inline text-amber-500" size={14} />
                    </Tooltip>
                  )}
                </Table.Td>
                <Table.Td className="max-w-[320px] text-xs text-gray-500">
                  <div className="truncate">{line.description}</div>
                  {line.priceSource && (
                    // Deal Engine C19/C23: price source, flags, foreign price and the EGP price used.
                    <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px]" data-testid="boq-price-source">
                      <span className="text-gray-500" data-testid="boq-line-supplier">
                        {line.priceSource === "supplier"
                          ? `${line.supplierName || line.supplierCode}${line.supplierName && line.supplierCode ? ` (${line.supplierCode})` : ""}`
                          : translate("Price Book reference price", "سعر مرجعي من دليل الأسعار")}
                      </span>
                      {line.foreignPrice != null && (
                        <span className="text-gray-500">
                          ({line.foreignPrice.toLocaleString("en-US")} {line.priceCurrency} x {line.fxRate})
                        </span>
                      )}
                      {(line.priceFlags || []).map((f) => (
                        <Tooltip key={f} label={f === "RECHECK PRICE" ? line.priceStaleReason || f : translate("No Approved supplier price - a Conditional supplier is used", "لا يوجد سعر من مورد معتمد - يُستخدم مورد مشروط")}>
                          <Badge size="xs" color={f === "RECHECK PRICE" ? "red" : "yellow"} variant="light">
                            {f}
                          </Badge>
                        </Tooltip>
                      ))}
                    </div>
                  )}
                  {line.priceNote && (
                    <div className="whitespace-normal text-[11px] text-amber-700" data-testid="boq-line-price-note">
                      {line.priceNote}
                    </div>
                  )}
                  {line.notes && <div className="whitespace-normal text-[11px] text-amber-700">{line.notes}</div>}
                </Table.Td>
                <Table.Td>{line.unit}</Table.Td>
                <Table.Td className="text-right">
                  <NumberInput size="xs" value={overrides[line.component]?.qty ?? line.qty ?? undefined} onChange={(v) => setOverride(line.component, "qty", v as number)} w={90} disabled={!canEditBoq} />
                </Table.Td>
                <Table.Td className="text-right">
                  <NumberInput size="xs" value={overrides[line.component]?.unitPrice ?? line.unitPrice ?? undefined} onChange={(v) => setOverride(line.component, "unitPrice", v as number)} w={110} disabled={!canEditBoq} />
                </Table.Td>
                <Table.Td className="text-right font-medium">{formatAmount(line.total, project.currency)}</Table.Td>
                <Table.Td>
                  <Badge size="sm" color={line.source === "override" ? "orange" : line.source === "manual" ? "gray" : "teal"} variant="light">
                    {line.source}
                  </Badge>
                  {line.source === "override" && (
                    <div className="mt-0.5 text-[10px] text-gray-400">
                      {translate("auto", "تلقائي")}: {line.autoQty} x {line.autoUnitPrice}
                      {canEditBoq && !isLocked && (
                        <Button
                          size="compact-xs"
                          variant="subtle"
                          color="gray"
                          ml={4}
                          disabled={!!busy}
                          loading={busy === `reset-${line.component}`}
                          onClick={() => recalculate({ [line.component]: null }, `reset-${line.component}`)}
                        >
                          {translate("reset to auto", "إعادة للتلقائي")}
                        </Button>
                      )}
                    </div>
                  )}
                </Table.Td>
                <Table.Td data-testid="boq-line-vendor">
                  {canSetVendor ? (
                    <Select
                      size="xs"
                      w={160}
                      placeholder={translate("No vendor selected", "لم يتم اختيار مورد")}
                      data={suppliers.map((s) => ({ value: s._id, label: `${s.code} - ${s.legalName}` }))}
                      value={line.vendor?._id || null}
                      onChange={(v) => setLineVendor(line.component, v)}
                      disabled={vendorBusy === line.component}
                      clearable
                      searchable
                    />
                  ) : line.vendor ? (
                    <span className="text-xs">
                      {line.vendor.code} - {line.vendor.legalName}
                    </span>
                  ) : (
                    <span className="text-xs text-gray-400">{translate("No vendor selected", "لم يتم اختيار مورد")}</span>
                  )}
                </Table.Td>
                <Table.Td data-testid="boq-line-procurement">
                  <div className="flex items-center gap-1.5">
                    <Badge size="sm" variant="light" color={!line.orderedQty ? "gray" : line.orderedQty >= (line.qty || 0) ? "green" : "yellow"}>
                      {!line.orderedQty ? translate("Not requested", "لم يُطلب") : line.orderedQty >= (line.qty || 0) ? translate("Fully ordered", "تم طلبه بالكامل") : translate("Partially ordered", "طُلب جزئياً")}
                    </Badge>
                    {canCreatePr && (line.qty || 0) > 0 && (
                      <Button size="compact-xs" variant="subtle" onClick={() => setPrLine(line)}>
                        {translate("Create PR", "إنشاء أمر شراء")}
                      </Button>
                    )}
                  </div>
                </Table.Td>
              </Table.Tr>
            ))}
            <Table.Tr className="font-semibold">
              <Table.Td colSpan={5} className="text-right">{translate("BOQ Total", "إجمالي جدول الكميات")}</Table.Td>
              <Table.Td className="text-right">{formatAmount(revision.boqTotal, project.currency)}</Table.Td>
              <Table.Td />
              <Table.Td />
              <Table.Td />
            </Table.Tr>
          </Table.Tbody>
        </DataTable>
      </DataTableContainer>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {canEditBoq && (
        <Button onClick={handleSave} loading={loading && busy === "save"} color="teal" disabled={!Object.keys(overrides).length || !!busy || isLocked} className="self-start">
          {translate("Save Overrides", "حفظ التعديلات")}
        </Button>
      )}

      <CreatePrModal opened={!!prLine} onClose={() => setPrLine(null)} revisionId={revision._id} line={prLine} suppliers={suppliers} onCreated={onChanged} />
    </div>
  );
}
