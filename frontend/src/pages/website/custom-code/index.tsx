import { useEffect, useState } from "react";
import { Alert, Badge, Button, Select, Switch, Table, Textarea, TextInput } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import Modal from "@/components/ui/modal";
import { CustomCodeKind, CustomCodePlacement, WebsiteCustomCode, WebsitePage } from "@/types/website";
import { formatCairoDateTime } from "@/pages/crm/_shared/business-date";
import { useCmsApi, useConfirm } from "../_shared/cms";

// Website Management - Custom Code (website administrators only - the server refuses everyone
// else on every request). Snippets are shown as TEXT in an editor; the dashboard never renders or
// runs them. They are added to the public website on its next update, where they run for every
// visitor - so every save is syntax-checked on the server (JavaScript is compiled, never run),
// risky patterns are flagged, and the full before/after is kept in the activity log.

const KIND_LABEL: Record<CustomCodeKind, { en: string; ar: string }> = { html: { en: "HTML snippet", ar: "مقتطف HTML" }, css: { en: "CSS", ar: "CSS" }, js: { en: "JavaScript", ar: "JavaScript" } };
const PLACEMENT_LABEL: Record<CustomCodePlacement, { en: string; ar: string }> = { head: { en: "Head", ar: "رأس الصفحة" }, body_start: { en: "Start of body", ar: "بداية المحتوى" }, body_end: { en: "End of body (footer)", ar: "نهاية المحتوى (التذييل)" } };

type Form = { _id?: string; name: string; description: string; kind: CustomCodeKind; placement: CustomCodePlacement; scope: "global" | "page"; page: string | null; code: string; isEnabled: boolean };
const EMPTY: Form = { name: "", description: "", kind: "html", placement: "head", scope: "global", page: null, code: "", isEnabled: true };

export default function WebsiteCustomCodePage() {
  const { language, translate } = useLanguage();
  const { call } = useCmsApi();
  const confirm = useConfirm();
  useDocumentTitle(`${translate("Custom Code", "الكود المخصص")} | Reservia Website`);
  const [rows, setRows] = useState<WebsiteCustomCode[]>([]);
  const [pages, setPages] = useState<WebsitePage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Form | null>(null);

  async function load() {
    setLoading(true);
    const [r, p] = await Promise.all([call<WebsiteCustomCode[]>({ url: "website/custom-code" }, { silent: true }), call<WebsitePage[]>({ url: "website/pages", params: { limit: 200 } }, { silent: true })]);
    if (r) {
      setRows(r.data);
      setError("");
    } else setError(translate("Could not load custom code.", "تعذر تحميل الكود المخصص."));
    setPages(p?.data || []);
    setLoading(false);
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggle(row: WebsiteCustomCode) {
    const r = await call({ url: `website/custom-code/${row._id}`, method: "PATCH", data: { isEnabled: !row.isEnabled } }, { success: row.isEnabled ? translate("Snippet disabled.", "تم تعطيل المقتطف.") : translate("Snippet enabled.", "تم تفعيل المقتطف.") });
    if (r) load();
  }

  async function remove(row: WebsiteCustomCode) {
    if (!(await confirm({ title: translate("Delete this snippet?", "حذف هذا المقتطف؟"), message: translate(`"${row.name}" is removed from the website on its next update.`, `سيُزال "${row.name}" من الموقع في التحديث التالي.`), confirmLabel: translate("Delete", "حذف"), danger: true }))) return;
    const r = await call({ url: `website/custom-code/${row._id}`, method: "DELETE" }, { success: translate("Snippet deleted.", "تم حذف المقتطف.") });
    if (r) load();
  }

  const pageName = (p: WebsiteCustomCode["page"]) => (p && typeof p === "object" ? p.titleEn || p.slug : "");

  return (
    <AdminLayoutBox
      header={{
        title: translate("Custom Code", "الكود المخصص"),
        subTitle: translate("HTML, CSS and JavaScript added to the public website. Administrators only.", "أكواد HTML وCSS وJavaScript تُضاف إلى الموقع العام. للمسؤولين فقط."),
        sideElements: (
          <Button color="teal" onClick={() => setEditing({ ...EMPTY })} data-testid="new-snippet">
            {translate("New snippet", "مقتطف جديد")}
          </Button>
        ),
      }}
    >
      <div className="flex flex-col gap-4">
        <Alert color="orange" variant="light" title={translate("Code here runs for every visitor of the website", "هذا الكود يعمل لكل زائر للموقع")}>
          {translate(
            "Only add code from providers you trust. Broken or malicious code can slow the site down, break pages or leak visitor data. Snippets are never run inside this dashboard, and every change is recorded in the activity log.",
            "لا تضف إلا كودًا من مزوّدين موثوقين. قد يبطئ الكود المعطوب أو الضار الموقع أو يعطل الصفحات أو يسرّب بيانات الزوار. لا تُشغَّل المقتطفات داخل لوحة التحكم، ويُسجَّل كل تغيير في سجل النشاط.",
          )}
        </Alert>
        {loading ? (
          <LoadingSection message={translate("Loading...", "جاري التحميل...")} />
        ) : error ? (
          <ErrorSection errorTitle={translate("Could not load", "تعذر التحميل")} errorMessage={error} button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: load }} />
        ) : rows.length === 0 ? (
          <Alert color="gray" variant="light">
            {translate("No custom code yet.", "لا يوجد كود مخصص بعد.")}
          </Alert>
        ) : (
          <Table verticalSpacing="sm" fz="sm" data-testid="snippets-table">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{translate("Name", "الاسم")}</Table.Th>
                <Table.Th>{translate("Type", "النوع")}</Table.Th>
                <Table.Th>{translate("Placement", "الموضع")}</Table.Th>
                <Table.Th>{translate("Applies to", "ينطبق على")}</Table.Th>
                <Table.Th>{translate("Updated", "آخر تحديث")}</Table.Th>
                <Table.Th>{translate("Enabled", "مفعّل")}</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((r) => (
                <Table.Tr key={r._id} data-testid="snippet-row">
                  <Table.Td>
                    <div className="font-medium">{r.name}</div>
                    {r.description && <div className="text-xs text-gray-500">{r.description}</div>}
                  </Table.Td>
                  <Table.Td>
                    <Badge variant="light">{translate(KIND_LABEL[r.kind || "html"].en, KIND_LABEL[r.kind || "html"].ar)}</Badge>
                  </Table.Td>
                  <Table.Td>{translate(PLACEMENT_LABEL[r.placement].en, PLACEMENT_LABEL[r.placement].ar)}</Table.Td>
                  <Table.Td>{r.scope === "page" ? pageName(r.page) : translate("Every page", "كل الصفحات")}</Table.Td>
                  <Table.Td className="text-xs">{formatCairoDateTime(r.updatedAt, language)}</Table.Td>
                  <Table.Td>
                    <Switch checked={r.isEnabled} onChange={() => toggle(r)} aria-label="enabled" />
                  </Table.Td>
                  <Table.Td>
                    <div className="flex justify-end gap-1">
                      <Button size="xs" variant="subtle" onClick={() => setEditing({ _id: r._id, name: r.name, description: r.description || "", kind: r.kind || "html", placement: r.placement, scope: r.scope, page: r.page && typeof r.page === "object" ? r.page._id : (r.page as string | null), code: r.code, isEnabled: r.isEnabled })}>
                        {translate("Edit", "تحرير")}
                      </Button>
                      <Button size="xs" variant="subtle" color="red" onClick={() => remove(r)}>
                        {translate("Delete", "حذف")}
                      </Button>
                    </div>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </div>
      <SnippetEditor
        form={editing}
        pages={pages}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          load();
        }}
      />
    </AdminLayoutBox>
  );
}

function SnippetEditor({ form, pages, onClose, onSaved }: { form: Form | null; pages: WebsitePage[]; onClose: () => void; onSaved: () => void }) {
  const { translate } = useLanguage();
  const { call } = useCmsApi();
  const confirm = useConfirm();
  const [f, setF] = useState<Form>(EMPTY);
  const [warnings, setWarnings] = useState<string[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (form) {
      setF(form);
      setWarnings(null);
    }
  }, [form]);
  if (!form) return null;
  const dirty = JSON.stringify(f) !== JSON.stringify(form);
  const set = (p: Partial<Form>) => {
    setF((x) => {
      const next = { ...x, ...p };
      if (next.kind === "css") next.placement = "head";
      return next;
    });
    setWarnings(null);
  };

  async function check() {
    setChecking(true);
    const r = await call<{ valid: boolean; warnings: string[] }>({ url: "website/custom-code/validate", method: "POST", data: { kind: f.kind, placement: f.placement, code: f.code } }, { error: translate("The code has a problem", "يوجد خطأ في الكود") });
    setWarnings(r ? r.data.warnings : null);
    setChecking(false);
    return r;
  }

  async function save() {
    const r = await check();
    if (!r) return;
    if (r.data.warnings.length && !(await confirm({ title: translate("Save with warnings?", "الحفظ مع التحذيرات؟"), message: <ul className="list-disc ps-5">{r.data.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>, confirmLabel: translate("Save anyway", "الحفظ على أي حال") }))) return;
    setSaving(true);
    const body = { name: f.name, description: f.description, kind: f.kind, placement: f.placement, scope: f.scope, page: f.scope === "page" ? f.page : null, code: f.code, isEnabled: f.isEnabled };
    const res = await call(f._id ? { url: `website/custom-code/${f._id}`, method: "PATCH", data: body } : { url: "website/custom-code", method: "POST", data: body }, { success: "server", error: translate("Could not save", "تعذر الحفظ") });
    setSaving(false);
    if (res) onSaved();
  }

  return (
    <Modal
      opened={!!form}
      onClose={async () => {
        if (!dirty || (await confirm({ title: translate("Discard changes?", "تجاهل التغييرات؟"), message: translate("The snippet has unsaved changes.", "يحتوي المقتطف على تغييرات غير محفوظة."), danger: true, confirmLabel: translate("Discard", "تجاهل") }))) onClose();
      }}
      title={f._id ? translate("Edit snippet", "تحرير المقتطف") : translate("New snippet", "مقتطف جديد")}
      size="xl"
    >
      <div className="flex flex-col gap-3" data-testid="snippet-editor">
        <div className="grid gap-3 sm:grid-cols-2">
          <TextInput label={translate("Name", "الاسم")} required value={f.name} onChange={(e) => set({ name: e.currentTarget.value })} maxLength={120} data-testid="snippet-name" />
          <TextInput label={translate("What it does", "ما الذي يفعله")} value={f.description} onChange={(e) => set({ description: e.currentTarget.value })} maxLength={300} />
          <Select
            label={translate("Type", "النوع")}
            value={f.kind}
            onChange={(v) => set({ kind: (v || "html") as CustomCodeKind, placement: v === "js" ? "body_end" : f.placement })}
            allowDeselect={false}
            data={(Object.keys(KIND_LABEL) as CustomCodeKind[]).map((k) => ({ value: k, label: translate(KIND_LABEL[k].en, KIND_LABEL[k].ar) }))}
            data-testid="snippet-kind"
          />
          <Select
            label={translate("Placement", "الموضع")}
            value={f.placement}
            onChange={(v) => set({ placement: (v || "head") as CustomCodePlacement })}
            allowDeselect={false}
            disabled={f.kind === "css"}
            data={(Object.keys(PLACEMENT_LABEL) as CustomCodePlacement[]).map((k) => ({ value: k, label: translate(PLACEMENT_LABEL[k].en, PLACEMENT_LABEL[k].ar) }))}
          />
          <Select
            label={translate("Applies to", "ينطبق على")}
            value={f.scope}
            onChange={(v) => set({ scope: (v || "global") as Form["scope"] })}
            allowDeselect={false}
            data={[
              { value: "global", label: translate("Every page", "كل الصفحات") },
              { value: "page", label: translate("One page", "صفحة واحدة") },
            ]}
          />
          {f.scope === "page" && <Select label={translate("Page", "الصفحة")} value={f.page} onChange={(v) => set({ page: v })} data={pages.map((p) => ({ value: p._id, label: `${p.titleEn || p.slug} (${p.path})` }))} searchable required />}
        </div>
        <Textarea
          label={f.kind === "css" ? translate("CSS rules (without <style>)", "قواعد CSS (بدون <style>)") : f.kind === "js" ? translate("JavaScript (without <script>)", "JavaScript (بدون <script>)") : translate("HTML (meta, script, noscript, link, style tags)", "HTML (وسوم meta وscript وnoscript وlink وstyle)")}
          value={f.code}
          onChange={(e) => set({ code: e.currentTarget.value })}
          autosize
          minRows={10}
          maxRows={26}
          dir="ltr"
          spellCheck={false}
          styles={{ input: { fontFamily: "var(--mantine-font-family-monospace)", fontSize: 12 } }}
          data-testid="snippet-code"
        />
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span dir="ltr">{new Blob([f.code]).size.toLocaleString()} / 65,536 bytes</span>
          <Switch label={translate("Enabled", "مفعّل")} checked={f.isEnabled} onChange={(e) => set({ isEnabled: e.currentTarget.checked })} />
        </div>
        {warnings && (
          <Alert color={warnings.length ? "yellow" : "teal"} variant="light" data-testid="snippet-check-result">
            {warnings.length ? (
              <ul className="list-disc ps-5 text-sm">
                {warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            ) : (
              translate("No problems found.", "لم يتم العثور على مشاكل.")
            )}
          </Alert>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="default" onClick={check} loading={checking} disabled={!f.code.trim()} data-testid="snippet-check">
            {translate("Check code", "فحص الكود")}
          </Button>
          <Button color="teal" onClick={save} loading={saving} disabled={!f.name.trim() || !f.code.trim() || (f.scope === "page" && !f.page)} data-testid="snippet-save">
            {translate("Save", "حفظ")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
