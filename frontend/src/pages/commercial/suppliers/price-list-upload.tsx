import { useEffect, useState } from "react";
import dayjs from "dayjs";
import { Alert, Badge, Button, Checkbox, FileInput, Select, Table, TextInput } from "@mantine/core";
import errorMessage from "@/utils/helpers/error-message";
import { useLanguage } from "@/context/LanguageContext";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import SectionCard from "@/components/ui/section-card";
import { MAPPING_FIELDS, type PriceListUpload as Upload } from "./types";

const STATUS_COLOR: Record<string, string> = { Update: "blue", New: "grape", Unchanged: "gray", Error: "red" };
const egp = (v: number | null | undefined) => (v == null ? "-" : Math.round(v).toLocaleString("en-US"));

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
            <p className="text-xs text-gray-600">
              {Object.entries(preview.summary)
                .map(([k, v]) => `${k}: ${v}`)
                .join(" · ")}
            </p>
            <div className="max-h-[420px] overflow-auto">
              <Table striped stickyHeader fz="xs" miw={980} data-testid="price-list-preview-table">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>#</Table.Th>
                    <Table.Th>{translate("Item (brand | model | spec)", "الصنف")}</Table.Th>
                    <Table.Th>{translate("Current (EGP)", "الحالي")}</Table.Th>
                    <Table.Th>{translate("New", "الجديد")}</Table.Th>
                    <Table.Th>{translate("Change", "التغير")}</Table.Th>
                    <Table.Th>{translate("Rated", "القيمة المقننة")}</Table.Th>
                    <Table.Th>{translate("Availability", "التوفر")}</Table.Th>
                    <Table.Th>{translate("Status", "الحالة")}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {preview.rows?.map((r) => (
                    <Table.Tr key={r.rowNo}>
                      <Table.Td>{r.rowNo}</Table.Td>
                      <Table.Td>
                        <div>{r.key}</div>
                        <div className="text-[10px] text-gray-500">{r.category}</div>
                      </Table.Td>
                      <Table.Td>{egp(r.current)}</Table.Td>
                      <Table.Td>
                        {r.currency !== "EGP" && r.price != null ? `${r.price.toLocaleString("en-US")} ${r.currency} = ` : ""}
                        {egp(r.egp)}
                      </Table.Td>
                      <Table.Td className={r.changePct != null && r.changePct > 0 ? "text-red-600" : "text-teal-700"}>{r.changePct != null ? `${r.changePct > 0 ? "+" : ""}${r.changePct}%` : "-"}</Table.Td>
                      <Table.Td>{r.ratedValue != null ? `${r.ratedValue} ${r.ratedUnit || ""}` : "-"}</Table.Td>
                      <Table.Td>
                        {r.availability}
                        {r.leadTimeDays ? ` (${r.leadTimeDays} d)` : ""}
                      </Table.Td>
                      <Table.Td>
                        <div className="flex items-center gap-1">
                          <Badge color={STATUS_COLOR[r.status]} variant="light" size="sm">
                            {r.status}
                          </Badge>
                          {r.status === "New" && (
                            <Checkbox
                              size="xs"
                              label={translate("create", "إنشاء")}
                              checked={createNew.includes(r.rowNo)}
                              onChange={(e) => setCreateNew((c) => (e.currentTarget.checked ? [...c, r.rowNo] : c.filter((n) => n !== r.rowNo)))}
                            />
                          )}
                        </div>
                        {r.errors.length > 0 && <div className="text-[10px] text-red-600">{r.errors.join("; ")}</div>}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </div>
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
            <Table fz="xs" miw={620}>
              <Table.Tbody>
                {history.map((h) => (
                  <Table.Tr key={h._id}>
                    <Table.Td>{h.fileName}</Table.Td>
                    <Table.Td>{dayjs(h.createdAt).format("DD MMM YYYY HH:mm")}</Table.Td>
                    <Table.Td>{h.uploadedByName || "-"}</Table.Td>
                    <Table.Td>
                      <Badge size="sm" variant="light" color={h.status === "confirmed" ? "teal" : h.status === "rolledBack" ? "orange" : "gray"}>
                        {h.status}
                      </Badge>
                    </Table.Td>
                    <Table.Td>{h.status !== "previewed" ? `${h.changes?.length ?? 0} ${translate("price(s)", "سعر")}, ${h.flaggedRevisions} ${translate("revision(s) flagged", "نسخة معلَّمة")}` : translate("not confirmed", "لم يؤكد")}</Table.Td>
                    <Table.Td className="text-right">
                      {canEdit && h.status === "confirmed" && (
                        <Button size="compact-xs" variant="subtle" color="orange" loading={busy === `rb-${h._id}`} onClick={() => rollback(h._id)}>
                          {translate("Roll back", "تراجع")}
                        </Button>
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </div>
        )}
      </div>
    </SectionCard>
  );
}
