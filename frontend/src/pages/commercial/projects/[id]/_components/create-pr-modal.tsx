import { useEffect, useState } from "react";
import { Badge, Button, NumberInput, Select, Table } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import Modal from "@/components/ui/modal";
import { BoqLine, BoqLineProcurementStatus } from "@/types/commercial";
import { requisitionStatusColors, useRequisitionStatusLabel } from "@/pages/admin/home/purchase-requisitions/_components/status";

type Supplier = { _id: string; code: string; legalName: string; status: string };

// Feature 3/B4 - "Create PR" on a BOQ line: creates a real draft ERP Purchase Order (Requisition)
// against the line's selected vendor (override allowed here), for up to its remaining quantity
// (split procurement - a smaller amount leaves the rest open for a later Purchase Order). Shows
// every Purchase Order already raised against this line so a repeat visit never looks like "Create
// PR" does nothing - the backend's own atomic guard (createPrService.js) is what actually prevents
// oversubscription; this form's max/disabled state is only a head start on that, not the guard.
export default function CreatePrModal({
  opened,
  onClose,
  revisionId,
  line,
  suppliers,
  onCreated,
  showPrices = true,
}: {
  opened: boolean;
  onClose: () => void;
  revisionId: string;
  line: BoqLine | null;
  suppliers: Supplier[];
  onCreated: () => void;
  // Pricing confidentiality: false for roles that may not see BOQ prices (the PO is then raised without one).
  showPrices?: boolean;
}) {
  const { translate, language } = useLanguage();
  const requisitionStatusLabel = useRequisitionStatusLabel();
  const { privateRequest, loading, setLoading, error, setError } = useDataHandler<null>({ initialData: null });
  const [status, setStatus] = useState<BoqLineProcurementStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState<number | "">("");

  useEffect(() => {
    if (!opened || !line) return;
    setSupplierId(line.vendor?._id || null);
    setStatus(null);
    setError("");
    setStatusLoading(true);
    privateRequest({ url: `commercial/revisions/${revisionId}/boq-lines/${encodeURIComponent(line.component)}/procurement-status`, language })
      .then((res) => {
        setStatus(res.data);
        setQuantity(res.data.remainingQty > 0 ? res.data.remainingQty : "");
      })
      .catch(() => setStatus(null))
      .finally(() => setStatusLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, line?.component]);

  function handleCreate() {
    if (!line) return;
    handleRequest(language, setLoading, setError, async () => {
      const res = await privateRequest({
        url: `commercial/revisions/${revisionId}/boq-lines/${encodeURIComponent(line.component)}/create-pr`,
        method: "POST",
        data: { supplierId, quantity },
        language,
      });
      setStatus((prev) =>
        prev
          ? {
              ...prev,
              orderedQty: prev.orderedQty + Number(quantity || 0),
              remainingQty: Math.max(0, prev.remainingQty - Number(quantity || 0)),
              requisitions: [...prev.requisitions, { _id: res.data._id, code: res.data.code, status: res.data.status, effectiveStatus: res.data.status, vendorId: res.data.vendorId, quantity: Number(quantity || 0), amount: res.data.amount, createdAt: res.data.createdAt }],
            }
          : prev
      );
      setQuantity("");
      onCreated();
    });
  }

  if (!line) return null;

  const remaining = status?.remainingQty ?? null;

  return (
    <Modal opened={opened} onClose={onClose} title={translate("Create Purchase Order", "إنشاء أمر شراء")} size="lg">
      <div className="flex flex-col gap-3">
        <div className="rounded-lg bg-gray-50 p-3 text-sm">
          <div className="font-medium">{line.component}</div>
          <div className="text-xs text-gray-500">{line.description}</div>
          <div className="mt-1 text-xs text-gray-500">
            {translate("BOQ Qty", "كمية جدول الكميات")}: {line.qty} {line.unit}
            {showPrices ? <> · {translate("Unit Price", "سعر الوحدة")}: {line.unitPrice}</> : <> · {translate("The Purchase Order is created without a unit price - Purchasing enters the agreed supplier price.", "يُنشأ أمر الشراء بدون سعر - تدخل المشتريات سعر المورد المتفق عليه.")}</>}
          </div>
        </div>

        {statusLoading ? (
          <p className="text-xs text-gray-400">{translate("Loading procurement status...", "تحميل حالة التوريد...")}</p>
        ) : status ? (
          <>
            <div className="flex items-center gap-4 text-sm">
              <span>
                {translate("Already ordered", "تم طلبه")}: <strong>{status.orderedQty}</strong>
              </span>
              <span>
                {translate("Remaining", "المتبقي")}: <strong>{status.remainingQty}</strong>
              </span>
            </div>

            {status.requisitions.length > 0 && (
              <Table withTableBorder className="text-xs" data-testid="linked-purchase-orders">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{translate("PO #", "رقم الأمر")}</Table.Th>
                    <Table.Th>{translate("Status", "الحالة")}</Table.Th>
                    <Table.Th className="text-right">{translate("Qty", "الكمية")}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {status.requisitions.map((r) => (
                    <Table.Tr key={r._id}>
                      <Table.Td>{r.code}</Table.Td>
                      <Table.Td>
                        <Badge size="sm" color={requisitionStatusColors[r.effectiveStatus]} variant="light">
                          {requisitionStatusLabel(r.effectiveStatus)}
                        </Badge>
                      </Table.Td>
                      <Table.Td className="text-right">{r.quantity}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            )}
          </>
        ) : null}

        {remaining !== null && remaining <= 0 ? (
          <p className="text-sm text-amber-600">{translate("This BOQ line's full quantity has already been placed on Purchase Orders.", "تم ترتيب الكمية الكاملة لهذا البند على أوامر الشراء بالفعل.")}</p>
        ) : (
          <>
            <Select
              label={translate("Vendor", "المورد")}
              placeholder={translate("Select a vendor", "اختر مورداً")}
              data={suppliers.map((s) => ({ value: s._id, label: `${s.code} - ${s.legalName}` }))}
              value={supplierId}
              onChange={setSupplierId}
              searchable
              required
            />
            <NumberInput
              label={translate("Quantity", "الكمية")}
              value={quantity}
              onChange={(v) => setQuantity(v as number | "")}
              min={0.01}
              max={remaining ?? undefined}
              suffix={line.unit ? ` ${line.unit}` : undefined}
              description={remaining !== null ? translate(`Up to ${remaining} ${line.unit || ""} remaining`, `بحد أقصى ${remaining} ${line.unit || ""} متبقية`) : undefined}
            />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button onClick={handleCreate} loading={loading} color="teal" disabled={!supplierId || !quantity} fullWidth>
              {translate("Create Purchase Order", "إنشاء أمر شراء")}
            </Button>
          </>
        )}
      </div>
    </Modal>
  );
}
