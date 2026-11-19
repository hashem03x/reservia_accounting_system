import { useEffect, useState } from "react";
import dayjs from "dayjs";
import errorMessage from "@/utils/helpers/error-message";
import { Alert, Button, NumberInput, Switch, Table, Textarea } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import SectionCard from "@/components/ui/section-card";
import { PricingConfig, PricingLevers } from "@/types/commercial";
import PctInput, { toPct } from "../_shared/PctInput";

// Nullable Sales-limits fields (R6/R7) - "" means "not set" (never 0, which is a real, different
// value from "no limit configured"). Mirrors toPct's fraction<->percent convention.
type NullablePct = number | "";
const toPctOrUnset = (fraction: number | null | undefined): NullablePct => (fraction == null ? "" : toPct(fraction));
const fromPctOrUnset = (pct: NullablePct): number | null => (pct === "" ? null : pct / 100);
import EngineSettingsCard from "./engine-settings-card";
import ProposalTextCard, { ProposalSettings } from "./proposal-text-card";

const LEVERS: { key: keyof PricingLevers; en: string; ar: string; hint: string }[] = [
  { key: "overheadPct", en: "Overhead", ar: "المصروفات العامة", hint: "% of COGS" },
  { key: "contingencyPct", en: "Contingency", ar: "الاحتياطي", hint: "% of COGS" },
  { key: "profitPct", en: "Profit", ar: "الربح", hint: "% of COGS" },
  { key: "salesBonusPct", en: "Sales bonus", ar: "مكافأة المبيعات", hint: "% of the markup pool" },
  { key: "engineeringIncentivePct", en: "Engineering incentive", ar: "حافز الهندسة", hint: "% of the markup pool" },
  { key: "categoryAdditionPct", en: "Category addition", ar: "إضافة الفئة", hint: "% of the base price" },
  { key: "discountPct", en: "Discount", ar: "الخصم", hint: "% of the pre-discount price" },
];

type AuditRow = { _id: string; version: number; before: { levers: PricingLevers; vatPctByCountry: Record<string, number> } | null; after: { levers: PricingLevers; vatPctByCountry: Record<string, number> }; note: string; changedByName: string | null; createdAt: string };

// QA finding B3 - the ONE pricing configuration record Finance maintains without a deploy. New
// revisions start from it; existing revisions keep the rates they were priced with. Editable only by
// Finance (ERP admin), the Commercial Director or the MD - enforced by the backend.
export default function PricingConfigPage() {
  const { translate, language } = useLanguage();
  useDocumentTitle(`${translate("Pricing Configuration", "إعدادات التسعير")} | Reservia Deal Engine`);

  const { privateRequest, loading, setLoading, error, setError, data: config, setData: setConfig } = useDataHandler<PricingConfig | null>({ initialData: null, initialLoading: true });
  const [levers, setLevers] = useState<Record<keyof PricingLevers, number> | null>(null);
  const [vatEgypt, setVatEgypt] = useState(14);
  const [vatKsa, setVatKsa] = useState(15);
  const [discountAuthority, setDiscountAuthority] = useState(5);
  const [categoryAdditionDefault, setCategoryAdditionDefault] = useState(19);
  const [categoryAdditionMin, setCategoryAdditionMin] = useState<NullablePct>("");
  const [categoryAdditionMax, setCategoryAdditionMax] = useState<NullablePct>("");
  const [discountMax, setDiscountMax] = useState(5);
  const [concessionCeiling, setConcessionCeiling] = useState<NullablePct>("");
  const [gpFloor, setGpFloor] = useState(15);
  const [requireMdApproval, setRequireMdApproval] = useState(false);
  const [note, setNote] = useState("");
  const [history, setHistory] = useState<AuditRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saved, setSaved] = useState("");

  function load() {
    handleRequest(language, setLoading, setError, async () => {
      const [res, hist] = await Promise.all([
        privateRequest({ url: "commercial/pricing-config", language }),
        privateRequest({ url: "commercial/pricing-config/history", language }),
      ]);
      const c = res.data as PricingConfig;
      setConfig(c);
      setLevers(Object.fromEntries(LEVERS.map((l) => [l.key, toPct(c.levers[l.key])])) as Record<keyof PricingLevers, number>);
      setVatEgypt(toPct(c.vatPctByCountry.Egypt ?? 0.14));
      setVatKsa(toPct(c.vatPctByCountry["Saudi Arabia"] ?? 0.15));
      setDiscountAuthority(toPct(c.discountAuthorityPct ?? 0.05));
      setCategoryAdditionDefault(toPct(c.salesLimits?.categoryAdditionDefaultPct ?? 0.19));
      setCategoryAdditionMin(toPctOrUnset(c.salesLimits?.categoryAdditionMinPct));
      setCategoryAdditionMax(toPctOrUnset(c.salesLimits?.categoryAdditionMaxPct));
      setDiscountMax(toPct(c.salesLimits?.discountMaxPct ?? 0.05));
      setConcessionCeiling(toPctOrUnset(c.salesLimits?.concessionCeilingPct));
      setGpFloor(toPct(c.salesLimits?.gpFloorPct ?? 0.15));
      setRequireMdApproval(!!c.requireMdApprovalForPolicyChange);
      setHistory(hist.data as AuditRow[]);
    });
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    if (!levers) return;
    setSaving(true);
    setSaveError("");
    setSaved("");
    try {
      await privateRequest({
        url: "commercial/pricing-config",
        method: "PUT",
        data: {
          levers: Object.fromEntries(LEVERS.map((l) => [l.key, levers[l.key] / 100])),
          vatPctByCountry: { Egypt: vatEgypt / 100, "Saudi Arabia": vatKsa / 100 },
          discountAuthorityPct: discountAuthority / 100,
          salesLimits: {
            categoryAdditionDefaultPct: categoryAdditionDefault / 100,
            categoryAdditionMinPct: fromPctOrUnset(categoryAdditionMin),
            categoryAdditionMaxPct: fromPctOrUnset(categoryAdditionMax),
            discountMaxPct: discountMax / 100,
            concessionCeilingPct: fromPctOrUnset(concessionCeiling),
            gpFloorPct: gpFloor / 100,
          },
          requireMdApprovalForPolicyChange: requireMdApproval,
          note,
        },
        language,
      });
      setNote("");
      setSaved(translate("Saved. New revisions use this configuration; existing revisions keep the rates they were priced with.", "تم الحفظ. النسخ الجديدة تستخدم هذه الإعدادات؛ النسخ الحالية تحتفظ بأسعارها."));
      load();
    } catch (e) {
      setSaveError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  if (error) return <ErrorSection errorTitle={translate("Error loading the pricing configuration", "خطأ في تحميل إعدادات التسعير")} errorMessage={error} button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: load }} />;
  if (loading || !config || !levers) return <LoadingSection />;
  const canManage = !!config.canManage;

  return (
    <AdminLayoutBox header={{ title: translate("Pricing Configuration", "إعدادات التسعير") }}>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SectionCard title={`${translate("Default pricing levers", "عوامل التسعير الافتراضية")} - v${config.version}`}>
          {!canManage && (
            <Alert color="gray" variant="light" mb="sm">
              {translate("Read-only. Only Finance (ERP admin), the Commercial Director or the MD can change the configuration.", "للقراءة فقط. يمكن للمالية أو المدير التجاري أو المدير العام فقط تعديل الإعدادات.")}
            </Alert>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {LEVERS.map((l) => (
              <PctInput key={l.key} label={translate(l.en, l.ar)} description={l.hint} value={levers[l.key]} onChange={(v) => setLevers((prev) => (prev ? { ...prev, [l.key]: v } : prev))} disabled={!canManage} />
            ))}
            <PctInput label={translate("VAT - Egypt", "الضريبة - مصر")} value={vatEgypt} onChange={setVatEgypt} disabled={!canManage} />
            <PctInput label={translate("VAT - Saudi Arabia", "الضريبة - السعودية")} value={vatKsa} onChange={setVatKsa} disabled={!canManage} />
            <PctInput label={translate("Discount authority (Stage 2 reviews above)", "حد صلاحية الخصم")} value={discountAuthority} onChange={setDiscountAuthority} disabled={!canManage} />
          </div>
          {canManage && (
            <>
              <Textarea
                mt="sm"
                label={translate("Reason for the change (required - kept in the audit log)", "سبب التغيير (مطلوب - يُحفظ في السجل)")}
                value={note}
                onChange={(e) => setNote(e.currentTarget.value)}
                required
              />
              {saveError && <p className="mt-2 text-sm text-red-600">{saveError}</p>}
              {saved && <p className="mt-2 text-sm text-teal-700">{saved}</p>}
              <Button mt="sm" color="teal" loading={saving} onClick={save} disabled={!note.trim()}>
                {translate("Save configuration", "حفظ الإعدادات")}
              </Button>
            </>
          )}
          <p className="mt-3 text-xs text-gray-400">
            {translate("Last changed", "آخر تغيير")}: {dayjs(config.updatedAt).format("DD MMM YYYY HH:mm")}
            {config.updatedByName ? ` - ${config.updatedByName}` : ""}
          </p>
        </SectionCard>

        <SectionCard title={translate("How it is applied", "كيف تُطبق")}>
          <ul className="list-disc space-y-1 ps-5 text-sm text-gray-600">
            <li>{translate("A new revision starts from these levers and records the configuration version it used.", "تبدأ النسخة الجديدة بهذه القيم وتسجل إصدار الإعدادات المستخدم.")}</li>
            <li>{translate("Existing revisions are never changed by a configuration edit - the Pricing tab can re-apply the current defaults explicitly.", "لا تتغير النسخ الحالية بتعديل الإعدادات - يمكن إعادة تطبيق القيم الافتراضية من تبويب التسعير.")}</li>
            <li>{translate("Profit is taken on COGS; sales bonus and engineering incentive on the markup pool; category addition on the base price.", "الربح على التكلفة؛ المكافأة والحافز على مجمع الهوامش؛ إضافة الفئة على السعر الأساسي.")}</li>
          </ul>
        </SectionCard>
      </div>

      <div className="mt-4">
        <SectionCard title={translate("Sales limits (Deal Engine Changes Required Rev 02)", "حدود المبيعات (التغييرات المطلوبة لمحرك الصفقات، نسخة 2)")}>
          <p className="mb-3 text-xs text-gray-500">
            {translate(
              "What Sales / BDM may move on a deal's Pricing tab without the Sales and Commercial Director's approval. A blank minimum, maximum or concession ceiling means it is not yet set - Sales may move that value freely until the MD confirms a real limit.",
              "ما يمكن لفريق المبيعات تغييره في تبويب التسعير دون موافقة المدير التجاري والمبيعات. الحد الأدنى أو الأقصى أو سقف التنازل الفارغ يعني أنه لم يُحدد بعد - يمكن للمبيعات تغيير هذه القيمة بحرية حتى يؤكد المدير العام حدًا حقيقيًا."
            )}
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <PctInput label={translate("Category addition - default", "إضافة الفئة - الافتراضي")} value={categoryAdditionDefault} onChange={setCategoryAdditionDefault} disabled={!canManage} />
            <NumberInput
              label={translate("Category addition - minimum", "إضافة الفئة - الحد الأدنى")}
              placeholder={translate("Not set", "غير محدد")}
              value={categoryAdditionMin}
              onChange={(v) => setCategoryAdditionMin(typeof v === "number" ? v : "")}
              suffix="%" min={0} max={100} disabled={!canManage}
            />
            <NumberInput
              label={translate("Category addition - maximum", "إضافة الفئة - الحد الأقصى")}
              placeholder={translate("Not set", "غير محدد")}
              value={categoryAdditionMax}
              onChange={(v) => setCategoryAdditionMax(typeof v === "number" ? v : "")}
              suffix="%" min={0} max={100} disabled={!canManage}
            />
            <PctInput label={translate("Discount - maximum", "الخصم - الحد الأقصى")} value={discountMax} onChange={setDiscountMax} disabled={!canManage} />
            <NumberInput
              label={translate("Overall concession ceiling", "سقف التنازل الإجمالي")}
              description={translate("Max combined drop of the net price from category addition + discount together", "أقصى انخفاض إجمالي في السعر الصافي من إضافة الفئة والخصم معًا")}
              placeholder={translate("Not set", "غير محدد")}
              value={concessionCeiling}
              onChange={(v) => setConcessionCeiling(typeof v === "number" ? v : "")}
              suffix="%" min={0} max={100} disabled={!canManage}
            />
            <PctInput label={translate("GP floor", "الحد الأدنى لإجمالي الربح")} description={translate("Stage 1 cannot pass below it", "لا يمكن أن تمر المرحلة الأولى دون هذا الحد")} value={gpFloor} onChange={setGpFloor} disabled={!canManage} />
          </div>
          <Switch
            mt="md"
            label={translate("Require MD approval for any pricing policy change", "تتطلب أي تغيير في سياسة التسعير موافقة المدير العام")}
            description={translate("Off by default. When on, only the MD (not the Commercial Director) can save this page.", "معطل افتراضيًا. عند التفعيل، يمكن للمدير العام فقط (دون المدير التجاري) حفظ هذه الصفحة.")}
            checked={requireMdApproval}
            onChange={(e) => setRequireMdApproval(e.currentTarget.checked)}
            disabled={!canManage}
          />
        </SectionCard>
      </div>

      {config.engine && (
        <div className="mt-4">
          <EngineSettingsCard key={config.version} engine={config.engine} canManage={canManage} onSaved={load} />
        </div>
      )}
      {config.proposal && (
        <div className="mt-4">
          <ProposalTextCard key={`p-${config.version}`} proposal={config.proposal as unknown as ProposalSettings} canManage={canManage} onSaved={load} />
        </div>
      )}

      <div className="mt-4">
        <SectionCard title={translate("Change history (audit log)", "سجل التغييرات")}>
          {history.length === 0 ? (
            <p className="text-sm text-gray-500">{translate("No changes yet - the brief 3.3 defaults are in force.", "لا توجد تغييرات بعد - القيم الافتراضية سارية.")}</p>
          ) : (
            <Table striped>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{translate("Version", "الإصدار")}</Table.Th>
                  <Table.Th>{translate("When", "التاريخ")}</Table.Th>
                  <Table.Th>{translate("By", "بواسطة")}</Table.Th>
                  <Table.Th>{translate("Changes", "التغييرات")}</Table.Th>
                  <Table.Th>{translate("Reason", "السبب")}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {history.map((h) => {
                  const changed = LEVERS.filter((l) => h.before?.levers?.[l.key] !== h.after.levers[l.key]).map(
                    (l) => `${l.en}: ${h.before ? `${toPct(h.before.levers[l.key])}%` : "-"} -> ${toPct(h.after.levers[l.key])}%`
                  );
                  return (
                    <Table.Tr key={h._id}>
                      <Table.Td>v{h.version}</Table.Td>
                      <Table.Td>{dayjs(h.createdAt).format("DD MMM YYYY HH:mm")}</Table.Td>
                      <Table.Td>{h.changedByName || "-"}</Table.Td>
                      <Table.Td className="text-xs">{changed.join("; ") || translate("VAT / authority only", "الضريبة / الصلاحية فقط")}</Table.Td>
                      <Table.Td className="text-xs">{h.note || "-"}</Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          )}
        </SectionCard>
      </div>
    </AdminLayoutBox>
  );
}
