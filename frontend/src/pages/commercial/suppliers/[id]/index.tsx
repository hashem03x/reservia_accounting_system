import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import dayjs from "dayjs";
import { Alert, Badge, Button, MultiSelect, NumberInput, Select, Table, Textarea, TextInput, TagsInput } from "@mantine/core";
import errorMessage from "@/utils/helpers/error-message";
import { useLanguage } from "@/context/LanguageContext";
import { useSystemAccess } from "@/context/SystemAccessContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import SectionCard from "@/components/ui/section-card";
import paths from "@/utils/constants/paths";
import { DOCUMENT_KINDS, EDIT_ROLES, PRICE_BOOK_CATEGORIES, STATUS_COLOR, Supplier, SupplierStatus, VendorCandidate } from "../types";
import PriceListUpload from "../price-list-upload";

// Who may set which status (backend services/commercial/supplierService.js STATUS_ROLES).
const STATUS_ROLES: Record<SupplierStatus, string[]> = { Approved: ["md"], Conditional: ["md"], Suspended: ["md", "commercial_director"], Removed: ["md", "commercial_director"], Candidate: ["md"] };
const SCORES = ["price", "quality", "delivery", "documentation", "support"] as const;

// Deal Engine C18 - one supplier: record, approval, documents with expiry, scorecard, append-only notes,
// and its price lists (C21-C24).
export default function SupplierPage() {
  const { id } = useParams();
  const { translate, language } = useLanguage();
  const { systems } = useSystemAccess();
  const role = systems?.COMMERCIAL?.role || "";
  const canEdit = EDIT_ROLES.includes(role);
  const { privateRequest, loading, setLoading, error, setError, data: s, setData } = useDataHandler<Supplier | null>({ initialData: null, initialLoading: true });
  const [form, setForm] = useState<Supplier | null>(null);
  const [statusTo, setStatusTo] = useState<SupplierStatus | "">("");
  const [statusNote, setStatusNote] = useState("");
  const [doc, setDoc] = useState({ kind: "Commercial register", name: "", expiry: "" });
  const [score, setScore] = useState<Record<string, number | "">>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Feature 1.3 - ERP Vendor sync.
  const [candidates, setCandidates] = useState<VendorCandidate[] | null>(null);
  const [newVendor, setNewVendor] = useState({ name: "", phone: "", email: "" });
  useDocumentTitle(`${s?.code || translate("Supplier", "مورد")} | Reservia Deal Engine`);

  function load() {
    handleRequest(language, setLoading, setError, async () => {
      const res = await privateRequest({ url: `commercial/suppliers/${id}`, language });
      const sup = res.data as Supplier;
      setData(sup);
      setForm(sup);
      setScore(Object.fromEntries(SCORES.map((k) => [k, sup.scorecard?.[k] ?? ""])));
      if (!sup.erpVendor) {
        setNewVendor({ name: sup.legalName.slice(0, 50), phone: sup.contacts[0]?.phone || "", email: sup.contacts[0]?.email || "" });
        privateRequest({ url: `commercial/suppliers/${id}/vendor-candidates`, language })
          .then((r) => setCandidates(r.data as VendorCandidate[]))
          .catch(() => setCandidates([]));
      } else {
        setCandidates(null);
      }
    });
  }
  useEffect(load, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function act(key: string, fn: () => Promise<{ message?: string }>) {
    setBusy(key);
    setMsg(null);
    try {
      const res = await fn();
      setMsg({ ok: true, text: res.message || translate("Saved.", "تم الحفظ.") });
      load();
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  if (loading && !s) return <LoadingSection />;
  if (error) return <ErrorSection errorTitle={translate("Could not load the supplier", "تعذر تحميل المورد")} errorMessage={error} button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: load }} />;
  if (!s || !form) return null;
  const allowedStatuses = (Object.keys(STATUS_ROLES) as SupplierStatus[]).filter((st) => st !== s.status && STATUS_ROLES[st].includes(role));
  const set = <K extends keyof Supplier>(k: K, v: Supplier[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));

  return (
    <AdminLayoutBox
      header={{
        backLink: `/${paths.commercial}/${paths.commercialSuppliers}`,
        title: `${s.code} - ${s.legalName}`,
        subTitle: s.tradeName || undefined,
        sideElements: (
          <Badge size="lg" color={STATUS_COLOR[s.status]} variant="light" data-testid="supplier-status">
            {s.status}
          </Badge>
        ),
      }}
    >
      <div className="flex flex-col gap-4">
        {s.reviewFlags.length > 0 && (
          <Alert color="red" variant="light" title={translate("Review needed", "مطلوب مراجعة")} data-testid="supplier-review-flags">
            {s.reviewFlags.join(" · ")}
          </Alert>
        )}
        {msg && (
          <Alert color={msg.ok ? "teal" : "red"} variant="light" data-testid="supplier-message">
            {msg.text}
          </Alert>
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <SectionCard title={translate("Supplier record", "بيانات المورد")}>
            <div className="flex flex-col gap-2">
              <TextInput label={translate("Legal name", "الاسم القانوني")} value={form.legalName} onChange={(e) => set("legalName", e.target.value)} disabled={!canEdit} />
              <TextInput label={translate("Trade name", "الاسم التجاري")} value={form.tradeName} onChange={(e) => set("tradeName", e.target.value)} disabled={!canEdit} />
              <div className="grid grid-cols-2 gap-2">
                <TextInput label={translate("Country", "الدولة")} value={form.country} onChange={(e) => set("country", e.target.value)} disabled={!canEdit} />
                <TextInput label={translate("City", "المدينة")} value={form.city} onChange={(e) => set("city", e.target.value)} disabled={!canEdit} />
              </div>
              <MultiSelect label={translate("Categories supplied", "الفئات")} data={PRICE_BOOK_CATEGORIES} value={form.categories} onChange={(v) => set("categories", v)} disabled={!canEdit} searchable />
              <TagsInput label={translate("Brands carried", "العلامات التجارية")} value={form.brands} onChange={(v) => set("brands", v)} disabled={!canEdit} />
              <div className="grid grid-cols-2 gap-2">
                <TextInput label={translate("Payment terms", "شروط الدفع")} value={form.terms.paymentTerms} onChange={(e) => set("terms", { ...form.terms, paymentTerms: e.target.value })} disabled={!canEdit} />
                <Select label={translate("Currency", "العملة")} data={["EGP", "USD", "EUR", "CNY"]} value={form.terms.currency} onChange={(v) => set("terms", { ...form.terms, currency: (v || "EGP") as Supplier["terms"]["currency"] })} allowDeselect={false} disabled={!canEdit} />
                <TextInput label={translate("Incoterms", "شروط التسليم")} value={form.terms.incoterms} onChange={(e) => set("terms", { ...form.terms, incoterms: e.target.value })} disabled={!canEdit} />
                <NumberInput label={translate("Lead time (days)", "مدة التوريد (أيام)")} value={form.terms.leadTimeDays ?? ""} onChange={(v) => set("terms", { ...form.terms, leadTimeDays: v === "" ? null : Number(v) })} min={0} disabled={!canEdit} />
              </div>
              <TextInput label={translate("Minimum order", "الحد الأدنى للطلب")} value={form.terms.minimumOrder} onChange={(e) => set("terms", { ...form.terms, minimumOrder: e.target.value })} disabled={!canEdit} />
              <h4 className="mt-1 text-sm font-semibold">{translate("Contacts", "جهات الاتصال")}</h4>
              {form.contacts.map((c, i) => (
                <div key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {(["name", "role", "phone", "email"] as const).map((k) => (
                    <TextInput key={k} size="xs" placeholder={k} value={c[k]} onChange={(e) => set("contacts", form.contacts.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)))} disabled={!canEdit} />
                  ))}
                </div>
              ))}
              {canEdit && (
                <div className="flex gap-2">
                  <Button size="xs" variant="subtle" onClick={() => set("contacts", [...form.contacts, { name: "", role: "", phone: "", email: "" }])}>
                    {translate("+ Contact", "+ جهة اتصال")}
                  </Button>
                  <Button
                    size="xs"
                    color="teal"
                    loading={busy === "save"}
                    onClick={() =>
                      act("save", () =>
                        privateRequest({
                          url: `commercial/suppliers/${s._id}`,
                          method: "PATCH",
                          language,
                          data: { legalName: form.legalName, tradeName: form.tradeName, country: form.country, city: form.city, categories: form.categories, brands: form.brands, terms: form.terms, contacts: form.contacts.filter((c) => c.name.trim()) },
                        }),
                      )
                    }
                    data-testid="supplier-save"
                  >
                    {translate("Save record", "حفظ البيانات")}
                  </Button>
                </div>
              )}
            </div>
          </SectionCard>

          <div className="flex flex-col gap-4">
            <SectionCard title={translate("Approval", "الاعتماد")}>
              <div className="text-sm text-gray-700">
                <div>
                  {translate("Proposed", "اقترحه")}: {s.approval.proposedByName || "-"} {s.approval.proposedAt ? `(${dayjs(s.approval.proposedAt).format("DD MMM YYYY")})` : ""}
                </div>
                <div>
                  {translate("Approved", "اعتمده")}: {s.approval.approvedByName || "-"} {s.approval.approvedAt ? `(${dayjs(s.approval.approvedAt).format("DD MMM YYYY")})` : ""}
                </div>
                <div>
                  {translate("Next review", "المراجعة القادمة")}: {s.approval.reviewDate ? dayjs(s.approval.reviewDate).format("DD MMM YYYY") : "-"}
                </div>
              </div>
              {allowedStatuses.length > 0 && (
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <Select size="xs" label={translate("Change status", "تغيير الحالة")} data={allowedStatuses} value={statusTo || null} onChange={(v) => setStatusTo((v as SupplierStatus) || "")} className="w-[150px]" data-testid="supplier-status-select" />
                  <TextInput size="xs" label={translate("Reason", "السبب")} value={statusNote} onChange={(e) => setStatusNote(e.target.value)} className="min-w-[200px] flex-1" />
                  <Button
                    size="xs"
                    disabled={!statusTo}
                    loading={busy === "status"}
                    onClick={() =>
                      act("status", async () => {
                        const r = await privateRequest({ url: `commercial/suppliers/${s._id}/status`, method: "PATCH", data: { status: statusTo, note: statusNote }, language });
                        setStatusTo("");
                        setStatusNote("");
                        return r;
                      })
                    }
                    data-testid="supplier-status-apply"
                  >
                    {translate("Apply", "تطبيق")}
                  </Button>
                </div>
              )}
            </SectionCard>

            <SectionCard title={translate("ERP Vendor", "مورد النظام")}>
              {s.erpVendor ? (
                <div className="flex items-center justify-between">
                  <div className="text-sm">
                    <div className="font-medium">
                      #{s.erpVendor.vendorNumber} - {s.erpVendor.name}
                    </div>
                    <div className="text-gray-500">{s.erpVendor.contact?.phone}</div>
                  </div>
                  {canEdit && (
                    <Button size="xs" variant="light" color="red" loading={busy === "unlink"} onClick={() => act("unlink", () => privateRequest({ url: `commercial/suppliers/${s._id}/unlink-vendor`, method: "POST", language }))}>
                      {translate("Unlink", "إلغاء الربط")}
                    </Button>
                  )}
                </div>
              ) : (
                <div className="flex flex-col gap-3 text-sm">
                  <Alert color="yellow" variant="light">
                    {translate("Not linked to an ERP vendor yet - Purchase Orders cannot reference this supplier until it is.", "لم يُربط بمورد في النظام بعد - لا يمكن إصدار أوامر شراء لهذا المورد حتى يتم الربط.")}
                  </Alert>
                  {candidates && candidates.length > 0 && (
                    <div>
                      <div className="mb-1 text-xs font-semibold text-gray-600">{translate("Possible matches (by phone or name)", "تطابقات محتملة (بالهاتف أو الاسم)")}</div>
                      {candidates.map((c) => (
                        <div key={c._id} className="flex items-center justify-between border-b border-gray-50 py-1">
                          <span>
                            #{c.vendorNumber} - {c.name} {c.contact?.phone ? `(${c.contact.phone})` : ""}
                          </span>
                          {canEdit && (
                            <Button size="xs" variant="light" loading={busy === `link-${c._id}`} onClick={() => act(`link-${c._id}`, () => privateRequest({ url: `commercial/suppliers/${s._id}/link-vendor`, method: "POST", data: { vendorId: c._id }, language }))}>
                              {translate("Link", "ربط")}
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {canEdit && (
                    <div>
                      <div className="mb-1 text-xs font-semibold text-gray-600">{translate("Or create a new ERP vendor", "أو إنشاء مورد جديد في النظام")}</div>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                        <TextInput size="xs" placeholder={translate("Vendor name", "اسم المورد")} value={newVendor.name} onChange={(e) => setNewVendor({ ...newVendor, name: e.target.value })} />
                        <TextInput size="xs" placeholder={translate("Phone", "الهاتف")} value={newVendor.phone} onChange={(e) => setNewVendor({ ...newVendor, phone: e.target.value })} />
                        <TextInput size="xs" placeholder={translate("Email (optional)", "البريد الإلكتروني (اختياري)")} value={newVendor.email} onChange={(e) => setNewVendor({ ...newVendor, email: e.target.value })} />
                      </div>
                      <Button
                        size="xs"
                        mt="xs"
                        color="teal"
                        disabled={!newVendor.name.trim() || !newVendor.phone.trim()}
                        loading={busy === "create-vendor"}
                        onClick={() => act("create-vendor", () => privateRequest({ url: `commercial/suppliers/${s._id}/create-vendor`, method: "POST", data: newVendor, language }))}
                      >
                        {translate("Create and link", "إنشاء وربط")}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </SectionCard>

            <SectionCard title={translate("Documents", "المستندات")}>
              <Table fz="xs">
                <Table.Tbody>
                  {s.documents.map((d) => (
                    <Table.Tr key={d._id}>
                      <Table.Td>{d.kind}</Table.Td>
                      <Table.Td>{d.name || "-"}</Table.Td>
                      <Table.Td className={d.expiry && dayjs(d.expiry).isBefore(dayjs()) ? "text-red-600" : ""}>{d.expiry ? `${translate("expires", "ينتهي")} ${dayjs(d.expiry).format("DD MMM YYYY")}` : "-"}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
              {canEdit && (
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-4">
                  <Select size="xs" data={DOCUMENT_KINDS} value={doc.kind} onChange={(v) => setDoc({ ...doc, kind: v || "Other" })} allowDeselect={false} />
                  <TextInput size="xs" placeholder={translate("Reference / name", "المرجع")} value={doc.name} onChange={(e) => setDoc({ ...doc, name: e.target.value })} />
                  <TextInput size="xs" type="date" value={doc.expiry} onChange={(e) => setDoc({ ...doc, expiry: e.target.value })} />
                  <Button size="xs" variant="light" loading={busy === "doc"} onClick={() => act("doc", () => privateRequest({ url: `commercial/suppliers/${s._id}/documents`, method: "POST", data: { ...doc, expiry: doc.expiry || null }, language }))}>
                    {translate("Record document", "تسجيل مستند")}
                  </Button>
                </div>
              )}
            </SectionCard>

            <SectionCard title={translate("Scorecard (1 to 5)", "بطاقة التقييم (1 إلى 5)")}>
              <div className="grid grid-cols-5 gap-2">
                {SCORES.map((k) => (
                  <NumberInput key={k} size="xs" label={k} value={score[k] ?? ""} onChange={(v) => setScore((p) => ({ ...p, [k]: v === "" ? "" : Number(v) }))} min={1} max={5} disabled={!canEdit} />
                ))}
              </div>
              {canEdit && (
                <Button size="xs" mt="xs" variant="light" loading={busy === "score"} onClick={() => act("score", () => privateRequest({ url: `commercial/suppliers/${s._id}/scorecard`, method: "PATCH", data: score, language }))}>
                  {translate("Update scorecard", "تحديث التقييم")}
                </Button>
              )}
            </SectionCard>
          </div>
        </div>

        <PriceListUpload supplierId={s._id} canEdit={canEdit && !["Suspended", "Removed"].includes(s.status)} onChanged={load} />

        <SectionCard title={translate("Notes and history (append-only)", "الملاحظات والسجل")}>
          <div className="flex flex-col gap-1 text-sm">
            {[...(s.notes || [])].reverse().map((n, i) => (
              <div key={i} className="border-b border-gray-50 py-1">
                <span className="text-xs text-gray-500">
                  {dayjs(n.at).format("DD MMM YYYY HH:mm")} · {n.byName || "-"} · {n.kind}
                </span>
                <div>{n.text}</div>
              </div>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <Textarea className="flex-1" autosize minRows={1} placeholder={translate("Add a note", "أضف ملاحظة")} value={note} onChange={(e) => setNote(e.target.value)} />
            <Button
              variant="light"
              loading={busy === "note"}
              disabled={!note.trim()}
              onClick={() =>
                act("note", async () => {
                  const r = await privateRequest({ url: `commercial/suppliers/${s._id}/notes`, method: "POST", data: { text: note }, language });
                  setNote("");
                  return r;
                })
              }
            >
              {translate("Add", "إضافة")}
            </Button>
          </div>
        </SectionCard>
      </div>
    </AdminLayoutBox>
  );
}
