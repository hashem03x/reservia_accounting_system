import { useState } from "react";
import dayjs from "dayjs";
import { Alert, Badge, Button } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { formatAmount } from "@/utils/helpers/format-amount";
import SectionCard from "@/components/ui/section-card";
import { CommercialProject, CommercialRevision, PricingLevers } from "@/types/commercial";
import PctInput, { toPct } from "../../../_shared/PctInput";

const LEVERS: { key: keyof PricingLevers; en: string; ar: string }[] = [
  { key: "overheadPct", en: "Overhead % (of COGS)", ar: "المصروفات العامة % (من التكلفة)" },
  { key: "contingencyPct", en: "Contingency % (of COGS)", ar: "الاحتياطي % (من التكلفة)" },
  { key: "profitPct", en: "Profit % (of COGS)", ar: "الربح % (من التكلفة)" },
  { key: "salesBonusPct", en: "Sales Bonus % (of pool)", ar: "مكافأة المبيعات % (من المجمع)" },
  { key: "engineeringIncentivePct", en: "Engineering Incentive % (of pool)", ar: "حافز الهندسة % (من المجمع)" },
  { key: "categoryAdditionPct", en: "Category Addition % (of base)", ar: "إضافة الفئة % (من الأساس)" },
  { key: "discountPct", en: "Discount %", ar: "الخصم %" },
];

// The pricing stack of Developer Brief 3.3 (backend services/commercial/commercialPricingService.js).
// A new revision starts from the Finance pricing configuration; the levers it was priced with are
// shown below ("Applied configuration") and stay with the revision until someone changes them here
// or explicitly re-applies the current configuration (QA finding B3).
export default function PricingTab({ project, revision, onChanged }: { project: CommercialProject; revision: CommercialRevision; onChanged: () => void }) {
  const { translate, language } = useLanguage();
  const p = revision.pricing;
  const applied = revision.pricingConfigApplied;
  const cur = project.currency;

  const [levers, setLevers] = useState<Record<keyof PricingLevers, number>>(
    () => Object.fromEntries(LEVERS.map((l) => [l.key, toPct(p[l.key] as number)])) as Record<keyof PricingLevers, number>
  );

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler<null>({ initialData: null });

  function save(body: Record<string, unknown>) {
    handleRequest(language, setLoading, setError, async () => {
      await privateRequest({ url: `commercial/revisions/${revision._id}`, method: "PATCH", data: body, language });
      onChanged();
    });
  }

  function handleSave() {
    const pricingOverrides = Object.fromEntries(LEVERS.map((l) => [l.key, levers[l.key] / 100]));
    save({ engineeringInput: revision.engineeringInput, pricingOverrides });
  }

  const Row = ({ label, value, bold, muted }: { label: string; value: React.ReactNode; bold?: boolean; muted?: boolean }) => (
    <div className={`flex justify-between gap-3 border-b border-gray-50 py-1.5 text-sm ${bold ? "font-semibold" : ""}`}>
      <span className={bold ? "text-gray-800" : muted ? "text-gray-400" : "text-gray-500"}>{label}</span>
      <span className="text-gray-800">{value}</span>
    </div>
  );
  const pct = (v: number | null | undefined) => (v != null ? `${(v * 100).toFixed(1)}%` : "-");
  const sourceLabel: Record<string, string> = {
    config: translate("Configuration defaults", "القيم الافتراضية للإعدادات"),
    revision: translate("Edited on this revision", "معدلة على هذه النسخة"),
    legacy: translate("Priced before the configuration existed", "سُعّرت قبل وجود الإعدادات"),
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="flex flex-col gap-4">
        <SectionCard title={translate("Markup Levers", "عوامل التسعير")}>
          {revision.status === "Draft" && (
            <Alert color="orange" variant="light" mb="xs">
              {translate("Draft - recalculating here also refreshes the site costs for the project's current region.", "مسودة - إعادة الحساب هنا تحدّث أيضاً تكاليف الموقع لمنطقة المشروع الحالية.")}
            </Alert>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {LEVERS.map((l) => (
              <PctInput key={l.key} label={translate(l.en, l.ar)} value={levers[l.key]} onChange={(v) => setLevers((prev) => ({ ...prev, [l.key]: v }))} />
            ))}
          </div>
          {p.discountAboveAuthority && (
            <p className="mt-2 text-xs text-amber-700">
              {translate("Discount is above the authority limit - Stage 2 must review it.", "الخصم أعلى من حد الصلاحية - يجب مراجعته في المرحلة 2.")}
            </p>
          )}
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={handleSave} loading={loading} color="teal">
              {translate("Recalculate Pricing", "إعادة حساب التسعير")}
            </Button>
            <Button variant="light" loading={loading} onClick={() => save({ applyCurrentConfig: true })}>
              {translate("Apply current default levers", "تطبيق القيم الافتراضية الحالية")}
            </Button>
          </div>
          <p className="mt-2 text-xs text-gray-400">
            {translate(
              "Changing any lever resets earlier sign-offs on this revision (re-approval rule).",
              "تغيير أي عامل يلغي الموافقات السابقة على هذه النسخة (قاعدة إعادة الموافقة)."
            )}
          </p>
        </SectionCard>

        <SectionCard title={translate("Applied Pricing Configuration", "إعدادات التسعير المطبقة")}>
          {applied?.source ? (
            <>
              <Row
                label={translate("Source", "المصدر")}
                value={
                  <span>
                    <Badge variant="light" color={applied.source === "config" ? "teal" : applied.source === "revision" ? "blue" : "gray"}>
                      {sourceLabel[applied.source] || applied.source}
                    </Badge>
                  </span>
                }
              />
              <Row label={translate("Configuration version", "إصدار الإعدادات")} value={applied.configVersion != null ? `v${applied.configVersion}` : "-"} />
              <Row label={translate("Applied on", "تاريخ التطبيق")} value={applied.appliedAt ? dayjs(applied.appliedAt).format("DD MMM YYYY HH:mm") : "-"} />
              <Row label={translate("VAT used", "الضريبة المستخدمة")} value={pct(applied.vatPct ?? p.vatPct)} />
              {applied.levers && (
                <p className="pt-2 text-xs text-gray-500">
                  {translate("Configuration levers at the time", "قيم الإعدادات وقتها")}:{" "}
                  {LEVERS.map((l) => `${l.en.split(" %")[0]} ${pct(applied.levers![l.key])}`).join(", ")}
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-gray-500">{translate("This revision predates the pricing configuration - it keeps the levers it was priced with.", "هذه النسخة أقدم من إعدادات التسعير - تحتفظ بالقيم التي سُعّرت بها.")}</p>
          )}
        </SectionCard>
      </div>

      <SectionCard title={translate("Price Build (Developer Brief 3.3)", "تركيبة السعر")}>
        <Row label={translate("Direct COGS (materials + site costs)", "التكلفة المباشرة (المواد + الموقع)")} value={formatAmount(p.cogs, cur)} />
        <Row label={`${translate("Overhead", "المصروفات العامة")} (${pct(p.overheadPct)})`} value={formatAmount(p.overheadAmt, cur)} />
        <Row label={`${translate("Contingency", "الاحتياطي")} (${pct(p.contingencyPct)})`} value={formatAmount(p.contingencyAmt, cur)} />
        <Row label={`${translate("Profit", "الربح")} (${pct(p.profitPct)} ${translate("of COGS", "من التكلفة")})`} value={formatAmount(p.profitAmt, cur)} />
        {p.poolAmt != null && <Row label={translate("Markup pool", "مجمع الهوامش")} value={formatAmount(p.poolAmt, cur)} muted />}
        <Row label={`${translate("Sales Bonus", "مكافأة المبيعات")} (${pct(p.salesBonusPct)})`} value={formatAmount(p.salesBonusAmt, cur)} />
        <Row label={`${translate("Engineering Incentive", "حافز الهندسة")} (${pct(p.engineeringIncentivePct)})`} value={formatAmount(p.engineeringIncentiveAmt, cur)} />
        {p.basePrice != null && <Row label={translate("Base price", "السعر الأساسي")} value={formatAmount(p.basePrice, cur)} muted />}
        <Row label={`${translate("Category Addition", "إضافة الفئة")} (${pct(p.categoryAdditionPct)})`} value={formatAmount(p.categoryAdditionAmt, cur)} />
        <Row label={`${translate("Discount", "الخصم")} (${pct(p.discountPct)})`} value={p.discountAmt ? `-${formatAmount(p.discountAmt, cur)}` : formatAmount(0, cur)} />
        <Row label={translate("NET PRICE (excl. VAT)", "السعر الصافي (قبل الضريبة)")} value={formatAmount(p.netExclVat, cur)} bold />
        <Row label={`${translate("VAT", "الضريبة")} (${pct(p.vatPct)})`} value={formatAmount(p.vatAmt, cur)} />
        <Row label={translate("FINAL PRICE (incl. VAT)", "السعر النهائي (شامل الضريبة)")} value={formatAmount(p.grossInclVat, cur)} bold />
        <Row
          label={`${translate("Price per kWp (excl. VAT)", "السعر لكل كيلوواط (قبل الضريبة)")}${p.designKwp ? ` - ${translate("net /", "الصافي /")} ${p.designKwp} ${translate("design kWp", "كيلوواط تصميمي")}` : ""}`}
          value={formatAmount(p.perKwpExclVat, cur)}
        />
        {p.perKwpInclVat != null && <Row label={translate("Price per kWp (incl. VAT)", "السعر لكل كيلوواط (شامل الضريبة)")} value={formatAmount(p.perKwpInclVat, cur)} muted />}
        <Row label={translate("Gross Profit", "إجمالي الربح")} value={`${formatAmount(p.grossProfit, cur)} (${pct(p.grossProfitPct)})`} />
        {p.operatingProfit != null && <Row label={translate("Operating Profit", "الربح التشغيلي")} value={`${formatAmount(p.operatingProfit, cur)} (${pct(p.operatingProfitPct)})`} />}
      </SectionCard>
    </div>
  );
}
