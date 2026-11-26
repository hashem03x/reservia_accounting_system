import { useEffect, useState } from "react";
import dayjs from "dayjs";
import { Alert, Badge, Button, FileInput, Modal, NumberInput, Select, Table, TextInput } from "@mantine/core";
import errorMessage from "@/utils/helpers/error-message";
import { useLanguage } from "@/context/LanguageContext";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import SectionCard from "@/components/ui/section-card";
import { MAPPING_FIELDS, type PriceListUpload as Upload } from "./types";
import PriceListRows from "./price-list-rows";

const supplierLabel = (u: Pick<Upload, "supplierName" | "supplierCode">) => (u.supplierName ? `${u.supplierName} (${u.supplierCode})` : u.supplierCode);

/**
 * Deal Engine C21-C24 / Spec Part 2 section 5. Choose a CSV/XLSX and the quote validity date; the
 * server proposes the column mapping (the supplier's saved one first) and returns a preview - current
 * price, new price, change %, availability, status, errors. Nothing is written until Confirm. A wrong
 * mapping can be corrected and the same file previewed again. Confirmed uploads can be rolled back.
 */
export default function PriceListUpload({ supplierId, canEdit, onChanged }: { supplierId: string; canEdit: boolean; onChanged: () => void }) {
  const { translate, language } = useLanguage();
  const privateRequest = usePrivateRequest();
  const [file, setFile] = useState<File | null>(null);
  const [validity, setValidity] = useState("");
  const [preview, setPreview] = useState<Upload | null>(null);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [createNew, setCreateNew] = useState<number[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [history, setHistory] = useState<Upload[]>([]);
  const [discountPct, setDiscountPct] = useState<number | "">("");
  // An earlier upload's stored rows (View) - supplier, quoted price, EGP price and errors per row.
  const [viewing, setViewing] = useState<Upload | null>(null);

  async function view(id: string) {
    setBusy(`view-${id}`);
    try {
      const res = await privateRequest({ url: `commercial/suppliers/price-lists/${id}`, language });
      setViewing(res.data as Upload);
    } catch (e) {
      setMessage({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  async function loadHistory() {
    try {
      const res = await privateRequest({ url: `commercial/suppliers/${supplierId}/price-lists`, language });
      setHistory(res.data as Upload[]);
    } catch {
      /* history is informative only */
    }
  }
  useEffect(() => {
    loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplierId]);

  async function runPreview(withMapping?: Record<string, string | null>) {
    if (!file) return;
    setBusy("preview");
    setMessage(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (validity) fd.append("validityDate", validity);
      if (withMapping) fd.append("mapping", JSON.stringify(withMapping));
      const body = await privateRequest({ url: `commercial/suppliers/${supplierId}/price-lists/preview`, method: "POST", data: fd, language });
      const up = body.data as Upload;
      setPreview(up);
      setMapping(up.mapping);
      setCreateNew([]);
    } catch (e) {
      setMessage({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  async function confirm() {
    if (!preview) return;
    setBusy("confirm");
    try {
      const res = await privateRequest({ url: `commercial/suppliers/price-lists/${preview._id}/confirm`, method: "POST", data: { createNew }, language });
      setMessage({ ok: true, text: res.message });
      setPreview(null);
      setFile(null);
      loadHistory();
      onChanged();
    } catch (e) {
      setMessage({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  async function applyDiscount() {
    if (!discountPct) return;
    setBusy("discount");
    setMessage(null);
    try {
      const res = await privateRequest({ url: `commercial/suppliers/${supplierId}/price-lists/discount`, method: "POST", data: { pct: discountPct }, language });
      setMessage({ ok: true, text: res.message });
      setDiscountPct("");
      loadHistory();
      onChanged();
    } catch (e) {
      setMessage({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  async function rollback(id: string) {
    setBusy(`rb-${id}`);
    try {
      const res = await privateRequest({ url: `commercial/suppliers/price-lists/${id}/rollback`, method: "POST", language });
      setMessage({ ok: true, text: res.message });
      loadHistory();
      onChanged();
    } catch (e) {
      setMessage({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  const writable = preview?.rows?.filter((r) => r.status === "Update").length || 0;

  return (
    <SectionCard title={translate("Supplier price lists", "قوائم أسعار المورد")}>
      <div className="flex flex-col gap-3" data-testid="price-list-upload">
        {canEdit && (
          <div className="flex flex-wrap items-end gap-2">
            <FileInput
              label={translate("Price list (CSV or XLSX)", "قائمة الأسعار (CSV أو XLSX)")}
              accept=".csv,.xlsx,.xls"
              value={file}
              onChange={(f) => {
                setFile(f);
                setPreview(null);
              }}
              className="min-w-[240px]"
              clearable
              data-testid="price-list-file"
            />
            <TextInput type="date" label={translate("Quote valid until", "صلاحية العرض حتى")} value={validity} onChange={(e) => setValidity(e.target.value)} />
            <Button onClick={() => runPreview()} loading={busy === "preview"} disabled={!file} data-testid="price-list-preview">
              {translate("Read and preview", "قراءة ومعاينة")}
            </Button>
          </div>
        )}
        <p className="text-xs text-gray-500">
          {translate("Send suppliers the standard template to reduce mapping work:", "أرسل للموردين النموذج القياسي لتقليل عمل الربط:")}{" "}
          <a className="text-primary-600 underline" href="/templates/supplier-price-list-template.xlsx" download data-testid="price-list-template">
            {translate("supplier price list template (XLSX)", "نموذج قائمة أسعار المورد (XLSX)")}
          </a>
        </p>

        {canEdit && (
          <div className="flex flex-wrap items-end gap-2 rounded-lg border border-gray-100 p-3">
            <NumberInput
              label={translate("Quick discount (%)", "خصم سريع (%)")}
              description={translate("Reduces every current price for this supplier by this % - no file needed.", "يخفض كل أسعار هذا المورد الحالية بهذه النسبة - دون حاجة لملف.")}
              placeholder="5"
              min={0.01}
              max={100}
              value={discountPct}
              onChange={(v) => setDiscountPct(v as number | "")}
              w={220}
              suffix="%"
              data-testid="price-list-discount-pct"
            />
            <Button variant="light" onClick={applyDiscount} loading={busy === "discount"} disabled={!discountPct} data-testid="price-list-apply-discount">
              {translate("Apply discount", "تطبيق الخصم")}
            </Button>
          </div>
        )}
        {message && (
          <Alert color={message.ok ? "teal" : "red"} variant="light" data-testid="price-list-message">
            {message.text}
          </Alert>
        )}

        {preview && (
          <>
            <div>
              <h4 className="mb-1 text-sm font-semibold">{translate("Column mapping", "ربط الأعمدة")}</h4>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {MAPPING_FIELDS.map((f) => (
                  <Select
                    key={f.key}
                    size="xs"
                    label={`${f.en}${f.required ? " *" : ""}`}
                    data={preview.headers.filter(Boolean)}
                    value={mapping[f.key] || null}
                    onChange={(v) => setMapping((m) => ({ ...m, [f.key]: v }))}
                    clearable={!f.required}
                  />
                ))}
              </div>
              <Button size="xs" variant="light" mt="xs" onClick={() => runPreview(mapping)} loading={busy === "preview"}>
                {translate("Preview again with this mapping", "معاينة مرة أخرى بهذا الربط")}
              </Button>
            </div>
            {preview.supplierPricesBoq === false || (preview.supplierStatus && !["Approved", "Conditional"].includes(preview.supplierStatus)) ? (
              <Alert color="yellow" variant="light" data-testid="price-list-not-pricing">
                {translate(
                  `${supplierLabel(preview)} is ${preview.supplierStatus}. Its prices will be stored, but the Deal Engine prices BOQs only from Approved or Conditional suppliers - approve the supplier for these prices to be used.`,
                  `${supplierLabel(preview)} حالته ${preview.supplierStatus}. ستُحفظ الأسعار، لكن محرك الصفقات يسعّر فقط من الموردين المعتمدين أو المشروطين - اعتمد المورد لاستخدام هذه الأسعار.`
                )}
              </Alert>
            ) : null}
            <p className="text-xs text-gray-600" data-testid="price-list-summary">
              {supplierLabel(preview)} · {translate("rows", "صفوف")}: {preview.summary.total ?? 0}
              {(["Update", "New", "Unchanged", "Error"] as const).map((k) => (preview.summary[k] ? ` · ${k}: ${preview.summary[k]}` : "")).join("")}
            </p>
            <PriceListRows
              rows={preview.rows || []}
              supplierLabel={supplierLabel(preview)}
              createNew={createNew}
              onToggleCreate={(rowNo, checked) => setCreateNew((c) => (checked ? [...c, rowNo] : c.filter((n) => n !== rowNo)))}
              testId="price-list-preview-table"
            />
            <p className="text-xs text-gray-500">
              {translate(
                "Confirm writes the Update rows and the New rows you ticked (new items start as placeholders until their electrical data is completed). Errors and unchanged rows are skipped. Open revisions using a changed item are flagged - nothing is recalculated automatically.",
                "التأكيد يكتب صفوف التحديث والصفوف الجديدة المحددة (الأصناف الجديدة تبدأ مؤقتة حتى تكتمل بياناتها الكهربائية). تُتجاهل الأخطاء والصفوف غير المتغيرة. تُعلَّم النسخ المفتوحة التي تستخدم صنفاً تغير سعره دون إعادة حساب تلقائية.",
              )}
            </p>
            <Button color="teal" onClick={confirm} loading={busy === "confirm"} disabled={!writable && !createNew.length} className="self-start" data-testid="price-list-confirm">
              {translate(`Confirm (${writable + createNew.length} price(s))`, `تأكيد (${writable + createNew.length} سعر)`)}
            </Button>
          </>
        )}

        <h4 className="mt-2 text-sm font-semibold">{translate("Upload history", "سجل الرفع")}</h4>
        {!history.length ? (
          <p className="text-xs text-gray-500">{translate("No uploads yet.", "لا يوجد رفع بعد.")}</p>
        ) : (
          <div className="overflow-x-auto">
            <Table fz="xs" miw={900} data-testid="price-list-history">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{translate("File", "الملف")}</Table.Th>
                  <Table.Th>{translate("Supplier", "المورد")}</Table.Th>
                  <Table.Th>{translate("Uploaded", "تاريخ الرفع")}</Table.Th>
                  <Table.Th>{translate("By", "بواسطة")}</Table.Th>
                  <Table.Th>{translate("Status", "الحالة")}</Table.Th>
                  <Table.Th className="text-right">{translate("Imported", "تم استيراده")}</Table.Th>
                  <Table.Th className="text-right">{translate("Rows with errors", "صفوف بها أخطاء")}</Table.Th>
                  <Table.Th>{translate("Revisions flagged", "نسخ معلَّمة")}</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {history.map((h) => (
                  <Table.Tr key={h._id} data-testid="price-list-history-row">
                    <Table.Td>{h.fileName}</Table.Td>
                    <Table.Td>
                      {supplierLabel(h)}
                      {h.supplierPricesBoq === false && (
                        <Badge size="xs" color="yellow" variant="light" ml={4}>
                          {translate(`${h.supplierStatus} - prices not used`, `${h.supplierStatus} - الأسعار غير مستخدمة`)}
                        </Badge>
                      )}
                    </Table.Td>
                    <Table.Td>{dayjs(h.createdAt).format("DD MMM YYYY HH:mm")}</Table.Td>
                    <Table.Td>{h.uploadedByName || "-"}</Table.Td>
                    <Table.Td>
                      <Badge size="sm" variant="light" color={h.status === "confirmed" ? "teal" : h.status === "rolledBack" ? "orange" : "gray"}>
                        {h.status === "previewed" ? translate("not confirmed", "لم يؤكد") : h.status}
                      </Badge>
                    </Table.Td>
                    <Table.Td className="text-right" data-testid="price-list-history-imported">
                      {h.counts?.imported ?? h.changes?.length ?? 0}
                      {h.kind !== "discount" && h.counts?.rows != null ? ` / ${h.counts.rows}` : ""}
                    </Table.Td>
                    <Table.Td className={`text-right ${h.counts?.errors ? "text-red-600" : ""}`}>{h.counts?.errors ?? 0}</Table.Td>
                    <Table.Td>{h.status !== "previewed" ? h.flaggedRevisions : "-"}</Table.Td>
                    <Table.Td className="text-right">
                      <div className="flex justify-end gap-1">
                        {h.kind !== "discount" && (
                          <Button size="compact-xs" variant="subtle" loading={busy === `view-${h._id}`} onClick={() => view(h._id)} data-testid="price-list-view">
                            {translate("View", "عرض")}
                          </Button>
                        )}
                        {canEdit && h.status === "confirmed" && (
                          <Button size="compact-xs" variant="subtle" color="orange" loading={busy === `rb-${h._id}`} onClick={() => rollback(h._id)}>
                            {translate("Roll back", "تراجع")}
                          </Button>
                        )}
                      </div>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </div>
        )}
        <Modal
          opened={!!viewing}
          onClose={() => setViewing(null)}
          size="90%"
          title={viewing ? `${viewing.fileName} - ${supplierLabel(viewing)}` : ""}
        >
          {viewing && (
            <div className="flex flex-col gap-2" data-testid="price-list-view-modal">
              <p className="text-xs text-gray-600">
                {dayjs(viewing.createdAt).format("DD MMM YYYY HH:mm")} · {viewing.uploadedByName || "-"} · {viewing.status} · {translate("imported", "تم استيراده")}: {viewing.counts?.imported ?? 0} / {viewing.counts?.rows ?? 0}
                {viewing.counts?.errors ? ` · ${translate("rows with errors", "صفوف بها أخطاء")}: ${viewing.counts.errors}` : ""}
              </p>
              <PriceListRows rows={viewing.rows || []} supplierLabel={supplierLabel(viewing)} testId="price-list-view-table" />
            </div>
          )}
        </Modal>
      </div>
    </SectionCard>
  );
}
