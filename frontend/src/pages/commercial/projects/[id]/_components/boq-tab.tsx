import { useEffect, useState } from "react";
import { Alert, Badge, Button, NumberInput, Select, Table, Tooltip } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import { useSystemAccess } from "@/context/SystemAccessContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { formatAmount } from "@/utils/helpers/format-amount";
import { DataTable, DataTableContainer, dataTableHeadClassName } from "@/components/ui/data-table";
import { solidIcons } from "@/components/icons";
import { notifyError } from "@/utils/helpers/notifiers";
import { BoqLine, CommercialProject, CommercialRevision, CommercialRole } from "@/types/commercial";
import { canEdit, projectTabAccess } from "../../../_shared/dealEnginePermissions";
import CreatePrModal from "./create-pr-modal";

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

  function handleSave() {
    handleRequest(language, setLoading, setError, async () => {
      await privateRequest({
        url: `commercial/revisions/${revision._id}`,
        method: "PATCH",
        data: { engineeringInput: revision.engineeringInput, manualOverrides: overrides },
        language,
      });
      setOverrides({});
      onChanged();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {revision.priceChangedSinceCalculation && (
        // Deal Engine C24 - a supplier price list changed an item this revision uses. Nothing recalculates
        // on its own; the sales engineer presses Recalculate on the Engineering Input tab.
        <Alert color="orange" variant="light" title={translate("Price changed since calculation", "تغيّر السعر منذ الحساب")} data-testid="price-changed-banner">
          {translate("A supplier price list changed", "قائمة أسعار مورد غيّرت")}: {(revision.priceChangedItems || []).join(", ")}. {translate("Recalculate on the Engineering Input tab to use the new prices.", "أعد الحساب من تبويب المدخلات الفنية لاستخدام الأسعار الجديدة.")}
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
                      <span className="text-gray-500">{line.priceSource === "supplier" ? line.supplierCode : translate("Reference price", "سعر مرجعي")}</span>
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
        <Button onClick={handleSave} loading={loading} color="teal" disabled={!Object.keys(overrides).length} className="self-start">
          {translate("Save Overrides", "حفظ التعديلات")}
        </Button>
      )}

      <CreatePrModal opened={!!prLine} onClose={() => setPrLine(null)} revisionId={revision._id} line={prLine} suppliers={suppliers} onCreated={onChanged} />
    </div>
  );
}
