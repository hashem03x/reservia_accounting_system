import { useEffect, useState } from "react";
import { Alert, Badge, Button, Checkbox, FileButton, Table } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import Modal from "@/components/ui/modal";
import { formatAmount } from "@/utils/helpers/format-amount";

// Deal Engine -> Materials -> "Import workbook": the client's own estimating workbooks
// (On_Grid.xlsx, Solar_Pumping_Agriculture_R07.xlsx...) become the Price Book, the Egypt Rates
// Matrix, the Agriculture pricing levers and the linked ERP products. Two steps: Preview (nothing is
// written - counts, changed prices, rows left out and why) then Import (the same file again; the
// server recomputes the plan). Backend: services/commercial/workbookImport/importService.js.

type CategoryRow = { category: string; create: number; update: number; unchanged: number; needsData: number };
type Change = { field: string; before: unknown; after: unknown };
type Preview = {
  workbook: { fileName: string; kind: string; title: string };
  notes: string[];
  items: {
    create: number; update: number; priceChanges: number; unchanged: number; skipped: number; archived: number; needsData: number;
    byCategory: CategoryRow[];
    skippedByReason: { reason: string; count: number }[];
    samples: {
      update: { category: string; brand: string; model: string; matchedBy: string; changes: Change[] }[];
      create: { category: string; brand: string; model: string; unitPrice: number; status: string; missing: string[] }[];
    };
  };
  rates: { status: "missing" | "changed" | "unchanged"; diffCount: number; diffs: { region: string; kind: string; band: string; before: number | null; after: number }[]; canApply: boolean } | null;
  pricing: { category: string; diffs: { lever: string; before: number; after: number }[]; canApply: boolean; reason: string | null } | null;
  erp: { canApply: boolean; reason: string | null; unlinked: number };
};
type Result = {
  items: { written: { inserted: number; modified: number; errorCount: number; errors: string[] } };
  rates: { created: boolean } | null;
  pricing: { applied: boolean } | null;
  erp: { created: number; linked: number; reused?: number; remaining?: number; failed?: number } | null;
};

const LEVER_LABEL: Record<string, [string, string]> = {
  overheadPct: ["Overhead", "المصاريف العامة"],
  contingencyPct: ["Contingency", "الطوارئ"],
  profitPct: ["Profit", "الربح"],
  salesBonusPct: ["Sales incentive", "حافز المبيعات"],
  engineeringIncentivePct: ["Engineering incentive", "حافز الهندسة"],
  categoryAdditionPct: ["Category addition", "إضافة الفئة"],
};
const pct = (v: number) => `${Math.round(v * 1000) / 10}%`;
const show = (v: unknown) => (typeof v === "number" ? v.toLocaleString() : Array.isArray(v) ? v.join(" / ") : v == null || v === "" ? "-" : String(v));

export default function WorkbookImportModal({ opened, onClose, onImported }: { opened: boolean; onClose: () => void; onImported: () => void }) {
  const { translate, language } = useLanguage();
  const privateRequest = usePrivateRequest();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState<"" | "preview" | "apply">("");
  const [error, setError] = useState("");
  const [opts, setOpts] = useState({ rates: false, pricing: false, erpProducts: false });

  useEffect(() => {
    if (opened) return;
    setFile(null);
    setPreview(null);
    setResult(null);
    setError("");
    setOpts({ rates: false, pricing: false, erpProducts: false });
  }, [opened]);

  async function send(path: "preview" | "apply", f: File) {
    const fd = new FormData();
    fd.append("file", f, f.name);
    if (path === "apply") fd.append("options", JSON.stringify(opts));
    const res = await privateRequest({ url: `commercial/materials/workbook-import/${path}`, method: "POST", data: fd, language });
    return res.data;
  }

  async function runPreview(f: File | null) {
    if (!f) return;
    setFile(f);
    setPreview(null);
    setResult(null);
    setError("");
    setBusy("preview");
    try {
      const p = (await send("preview", f)) as Preview;
      setPreview(p);
      setOpts({ rates: !!p.rates?.canApply && p.rates.status !== "unchanged", pricing: false, erpProducts: !!p.erp?.canApply });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function runImport() {
    if (!file) return;
    setBusy("apply");
    setError("");
    try {
      setResult((await send("apply", file)) as Result);
      onImported();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  const nothingToDo = preview && !preview.items.create && !preview.items.update && (!preview.rates || preview.rates.status === "unchanged") && (!preview.pricing || !preview.pricing.diffs.length) && !(opts.erpProducts && preview.erp.unlinked);

  return (
    <Modal opened={opened} onClose={onClose} title={translate("Import a workbook", "استيراد ملف Excel")} size="xl">
      <div className="flex flex-col gap-4" data-testid="workbook-import">
        <p className="text-sm text-ink-secondary">
          {translate(
            "Upload one of the client's estimating workbooks: On_Grid.xlsx (On-Grid price list and Egypt rates) or Solar_Pumping_Agriculture_R07.xlsx (the Agriculture master price list). You see what would change first; nothing is written until you import. Items already in the Price Book are updated, never duplicated.",
            "ارفع أحد ملفات التسعير الخاصة بالعميل: On_Grid.xlsx (قائمة أسعار الربط بالشبكة وأسعار مصر) أو Solar_Pumping_Agriculture_R07.xlsx (قائمة الأسعار الرئيسية للزراعة). تظهر التغييرات أولاً ولا يُحفظ شيء حتى تضغط استيراد. البنود الموجودة تُحدَّث ولا تتكرر."
          )}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <FileButton onChange={runPreview} accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet">
            {(props) => (
              <Button {...props} loading={busy === "preview"} variant={preview ? "light" : "filled"} data-testid="workbook-choose">
                {preview ? translate("Choose another workbook", "اختر ملفاً آخر") : translate("Choose workbook (.xlsx)", "اختر الملف (.xlsx)")}
              </Button>
            )}
          </FileButton>
          {file && <span className="text-sm text-ink-secondary">{file.name}</span>}
        </div>

        {error && (
          <Alert color="red" variant="light" data-testid="workbook-error">
            {error}
          </Alert>
        )}

        {preview && !result && (
          <div className="flex flex-col gap-4" data-testid="workbook-preview">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="light">{preview.workbook.title}</Badge>
              <Badge color="teal" variant="light">{translate(`${preview.items.create} new`, `${preview.items.create} جديد`)}</Badge>
              <Badge color="blue" variant="light">{translate(`${preview.items.update} updated (${preview.items.priceChanges} price changes)`, `${preview.items.update} تحديث (${preview.items.priceChanges} تغيير سعر)`)}</Badge>
              <Badge color="gray" variant="light">{translate(`${preview.items.unchanged} unchanged`, `${preview.items.unchanged} دون تغيير`)}</Badge>
              {preview.items.skipped > 0 && <Badge color="orange" variant="light">{translate(`${preview.items.skipped} rows left out`, `${preview.items.skipped} صف مستبعد`)}</Badge>}
              {preview.items.archived > 0 && <Badge color="gray" variant="outline">{translate(`${preview.items.archived} archived (kept archived)`, `${preview.items.archived} مؤرشف (يبقى مؤرشفاً)`)}</Badge>}
            </div>

            {preview.notes.map((n) => (
              <p key={n} className="text-xs text-ink-secondary">
                {n}
              </p>
            ))}

            {preview.items.byCategory.length > 0 && (
              <Table withTableBorder striped fz="sm" data-testid="workbook-categories">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{translate("Category", "الفئة")}</Table.Th>
                    <Table.Th className="text-right">{translate("New", "جديد")}</Table.Th>
                    <Table.Th className="text-right">{translate("Updated", "محدَّث")}</Table.Th>
                    <Table.Th className="text-right">{translate("Unchanged", "دون تغيير")}</Table.Th>
                    <Table.Th className="text-right">{translate("Needs technical data", "تحتاج بيانات فنية")}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {preview.items.byCategory.map((c) => (
                    <Table.Tr key={c.category}>
                      <Table.Td>{c.category}</Table.Td>
                      <Table.Td className="text-right">{c.create}</Table.Td>
                      <Table.Td className="text-right">{c.update}</Table.Td>
                      <Table.Td className="text-right">{c.unchanged}</Table.Td>
                      <Table.Td className={`text-right ${c.needsData ? "text-orange-600" : ""}`}>{c.needsData}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            )}

            {preview.items.needsData > 0 && (
              <Alert color="orange" variant="light">
                {translate(
                  `${preview.items.needsData} new item(s) have no electrical data in the workbook (e.g. PV modules without Vmp/Voc). They are imported but kept out of the calculation until the datasheet values are entered on this page (Edit -> Technical data).`,
                  `${preview.items.needsData} بند جديد بلا بيانات كهربائية في الملف. تُستورد لكن لا تُستخدم في الحساب حتى تُدخل قيم نشرة البيانات من هذه الصفحة (تعديل -> البيانات الفنية).`
                )}
              </Alert>
            )}

            {preview.items.samples.update.some((u) => u.changes.some((c) => c.field === "price")) && (
              <div>
                <p className="mb-1 text-sm font-semibold">{translate("Reference price changes", "تغييرات السعر المرجعي")}</p>
                <Table withTableBorder fz="xs">
                  <Table.Tbody>
                    {preview.items.samples.update
                      .filter((u) => u.changes.some((c) => c.field === "price"))
                      .map((u) => {
                        const c = u.changes.find((x) => x.field === "price")!;
                        return (
                          <Table.Tr key={`${u.brand}-${u.model}`}>
                            <Table.Td>{u.category}</Table.Td>
                            <Table.Td>
                              {u.brand} {u.model}
                            </Table.Td>
                            <Table.Td className="text-right">
                              {formatAmount(Number(c.before), "EGP")} → <b>{formatAmount(Number(c.after), "EGP")}</b>
                            </Table.Td>
                          </Table.Tr>
                        );
                      })}
                  </Table.Tbody>
                </Table>
                <p className="mt-1 text-xs text-ink-secondary">{translate("The old price stays in the item's price history; existing revisions keep the price they were calculated with.", "يبقى السعر القديم في سجل أسعار البند، وتحتفظ المراجعات الحالية بالسعر الذي حُسبت به.")}</p>
              </div>
            )}

            {preview.items.skippedByReason.length > 0 && (
              <div className="text-xs text-ink-secondary">
                <p className="font-semibold">{translate("Rows left out", "صفوف مستبعدة")}</p>
                {preview.items.skippedByReason.map((s) => (
                  <div key={s.reason}>
                    {s.count} × {s.reason}
                  </div>
                ))}
              </div>
            )}

            {preview.rates && (
              <div className="rounded-md border border-gray-100 p-3" data-testid="workbook-rates">
                <Checkbox
                  label={
                    preview.rates.status === "unchanged"
                      ? translate("Egypt Rates Matrix: same as the version in force - nothing to change", "مصفوفة أسعار مصر: مطابقة للنسخة السارية")
                      : preview.rates.status === "missing"
                        ? translate("Create the Egypt Rates Matrix from this workbook (none exists yet)", "إنشاء مصفوفة أسعار مصر من هذا الملف (لا توجد بعد)")
                        : translate(`Save the workbook's Egypt rates as a new Rates Matrix version (${preview.rates.diffCount} values differ)`, `حفظ أسعار مصر من الملف كنسخة جديدة (${preview.rates.diffCount} قيمة مختلفة)`)
                  }
                  checked={opts.rates}
                  disabled={!preview.rates.canApply || preview.rates.status === "unchanged"}
                  onChange={(e) => setOpts((o) => ({ ...o, rates: e.currentTarget.checked }))}
                  data-testid="workbook-opt-rates"
                />
                {!preview.rates.canApply && preview.rates.status !== "unchanged" && (
                  <p className="mt-1 text-xs text-orange-600">{translate("Only a Pricing Config manager (MD, Sales and Commercial Director or ERP admin) can change the Rates Matrix.", "تعديل مصفوفة الأسعار لمدير إعدادات التسعير فقط.")}</p>
                )}
                {preview.rates.diffs.slice(0, 8).map((d) => (
                  <div key={`${d.region}-${d.kind}-${d.band}`} className="text-xs text-ink-secondary">
                    {d.region} · {d.kind} · {d.band}: {show(d.before)} → <b>{show(d.after)}</b>
                  </div>
                ))}
              </div>
            )}

            {preview.pricing && (
              <div className="rounded-md border border-gray-100 p-3" data-testid="workbook-pricing">
                <Checkbox
                  label={
                    preview.pricing.diffs.length
                      ? translate(`Use the workbook's ${preview.pricing.category} pricing levers for NEW ${preview.pricing.category} revisions`, `استخدام نسب التسعير من الملف لمراجعات ${preview.pricing.category} الجديدة`)
                      : translate(`${preview.pricing.category} pricing levers: same as Pricing Config`, `نسب تسعير ${preview.pricing.category}: مطابقة لإعدادات التسعير`)
                  }
                  checked={opts.pricing}
                  disabled={!preview.pricing.canApply || !preview.pricing.diffs.length}
                  onChange={(e) => setOpts((o) => ({ ...o, pricing: e.currentTarget.checked }))}
                  data-testid="workbook-opt-pricing"
                />
                {preview.pricing.diffs.map((d) => (
                  <div key={d.lever} className="text-xs text-ink-secondary">
                    {translate(LEVER_LABEL[d.lever]?.[0] || d.lever, LEVER_LABEL[d.lever]?.[1] || d.lever)}: {pct(d.before)} → <b>{pct(d.after)}</b>
                  </div>
                ))}
                {preview.pricing.diffs.length > 0 && (
                  <p className="mt-1 text-xs text-ink-secondary">
                    {preview.pricing.canApply
                      ? translate("Saved through Pricing Config (recorded in its change history). Other categories and existing revisions are not affected.", "يُحفظ عبر إعدادات التسعير ويُسجَّل في سجل التغييرات. لا يؤثر على الفئات الأخرى أو المراجعات الحالية.")
                      : preview.pricing.reason}
                  </p>
                )}
              </div>
            )}

            <div className="rounded-md border border-gray-100 p-3" data-testid="workbook-erp">
              <Checkbox
                label={translate("Create the ERP products for Price Book items that have none, and link them (so Won deals and purchase requests find them)", "إنشاء منتجات النظام للبنود التي ليس لها منتج وربطها (لتنتقل الصفقات الرابحة وطلبات الشراء تلقائياً)")}
                checked={opts.erpProducts}
                disabled={!preview.erp.canApply}
                onChange={(e) => setOpts((o) => ({ ...o, erpProducts: e.currentTarget.checked }))}
                data-testid="workbook-opt-erp"
              />
              <p className="mt-1 text-xs text-ink-secondary">
                {preview.erp.canApply
                  ? translate(`An existing ERP product is reused when brand and model match exactly. ${preview.erp.unlinked} item(s) currently have no ERP product.`, `يُعاد استخدام منتج النظام عند تطابق الماركة والموديل تماماً. ${preview.erp.unlinked} بند بلا منتج حالياً.`)
                  : preview.erp.reason}
              </p>
            </div>

            <div className="flex justify-end">
              <Button onClick={runImport} loading={busy === "apply"} disabled={!!nothingToDo} color="teal" data-testid="workbook-apply">
                {nothingToDo ? translate("Nothing to import", "لا يوجد ما يُستورد") : translate("Import", "استيراد")}
              </Button>
            </div>
          </div>
        )}

        {result && (
          <Alert color={result.items.written.errorCount ? "orange" : "green"} variant="light" data-testid="workbook-result">
            <div>{translate(`Price Book: ${result.items.written.inserted} added, ${result.items.written.modified} updated.`, `قائمة الأسعار: ${result.items.written.inserted} مضاف، ${result.items.written.modified} محدَّث.`)}</div>
            {result.rates?.created && <div>{translate("A new Egypt Rates Matrix version was saved.", "حُفظت نسخة جديدة من مصفوفة أسعار مصر.")}</div>}
            {result.pricing?.applied && <div>{translate("The pricing levers were saved in Pricing Config.", "حُفظت نسب التسعير في إعدادات التسعير.")}</div>}
            {result.erp && (
              <div>
                {translate(`ERP: ${result.erp.created} product(s) created, ${result.erp.linked} linked.`, `النظام: إنشاء ${result.erp.created} منتج، وربط ${result.erp.linked}.`)}
                {result.erp.remaining ? translate(` ${result.erp.remaining} still unlinked.`, ` ${result.erp.remaining} ما زال دون ربط.`) : ""}
              </div>
            )}
            {result.items.written.errors.map((e) => (
              <div key={e} className="text-xs">
                {e}
              </div>
            ))}
          </Alert>
        )}
      </div>
    </Modal>
  );
}
