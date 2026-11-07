import { useState } from "react";
import { Button, NumberInput } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { formatAmount } from "@/utils/helpers/format-amount";
import SectionCard from "@/components/ui/section-card";
import { CommercialProject, CommercialRevision } from "@/types/commercial";

// The configurable COMMERCIAL PRICING layer (services/commercial/commercialPricingService.js) -
// kept deliberately separate from the engineering BOQ above. None of the levers below are
// Excel-sourced defaults except Off-Grid's contingency/profit (see that service's own header
// comment) - every percentage here is whatever the commercial team has actually set, never a
// hidden default silently applied.
export default function PricingTab({ project, revision, onChanged }: { project: CommercialProject; revision: CommercialRevision; onChanged: () => void }) {
  const { translate, language } = useLanguage();
  const p = revision.pricing;

  const [overheadPct, setOverheadPct] = useState(p.overheadPct * 100);
  const [contingencyPct, setContingencyPct] = useState(p.contingencyPct * 100);
  const [profitPct, setProfitPct] = useState(p.profitPct * 100);
  const [salesBonusPct, setSalesBonusPct] = useState(p.salesBonusPct * 100);
  const [engineeringIncentivePct, setEngineeringIncentivePct] = useState(p.engineeringIncentivePct * 100);
  const [categoryAdditionPct, setCategoryAdditionPct] = useState(p.categoryAdditionPct * 100);
  const [discountPct, setDiscountPct] = useState(p.discountPct * 100);

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler<null>({ initialData: null });

  function handleSave() {
    handleRequest(language, setLoading, setError, async () => {
      const pricingOverrides = {
        overheadPct: overheadPct / 100, contingencyPct: contingencyPct / 100, profitPct: profitPct / 100,
        salesBonusPct: salesBonusPct / 100, engineeringIncentivePct: engineeringIncentivePct / 100,
        categoryAdditionPct: categoryAdditionPct / 100, discountPct: discountPct / 100, vatPct: p.vatPct,
      };
      await privateRequest({
        url: `commercial/revisions/${revision._id}`,
        method: "PATCH",
        data: { engineeringInput: revision.engineeringInput, pricingOverrides },
        language,
      });
      onChanged();
    });
  }

  const Row = ({ label, value, bold }: { label: string; value: React.ReactNode; bold?: boolean }) => (
    <div className={`flex justify-between gap-3 border-b border-gray-50 py-1.5 text-sm ${bold ? "font-semibold" : ""}`}>
      <span className={bold ? "text-gray-800" : "text-gray-500"}>{label}</span>
      <span className="text-gray-800">{value}</span>
    </div>
  );

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <SectionCard title={translate("Markup Levers", "عوامل التسعير")}>
        <div className="grid grid-cols-2 gap-3">
          <NumberInput label={translate("Overhead %", "النسبة العامة %")} value={overheadPct} onChange={(v) => setOverheadPct((v as number) || 0)} suffix="%" />
          <NumberInput label={translate("Contingency %", "الاحتياطي %")} value={contingencyPct} onChange={(v) => setContingencyPct((v as number) || 0)} suffix="%" />
          <NumberInput label={translate("Profit %", "الربح %")} value={profitPct} onChange={(v) => setProfitPct((v as number) || 0)} suffix="%" />
          <NumberInput label={translate("Sales Bonus % (of pool)", "مكافأة المبيعات % (من الإجمالي)")} value={salesBonusPct} onChange={(v) => setSalesBonusPct((v as number) || 0)} suffix="%" />
          <NumberInput label={translate("Engineering Incentive % (of pool)", "حافز الهندسة %")} value={engineeringIncentivePct} onChange={(v) => setEngineeringIncentivePct((v as number) || 0)} suffix="%" />
          <NumberInput label={translate("Category Addition %", "إضافة الفئة %")} value={categoryAdditionPct} onChange={(v) => setCategoryAdditionPct((v as number) || 0)} suffix="%" />
          <NumberInput label={translate("Discount %", "الخصم %")} value={discountPct} onChange={(v) => setDiscountPct((v as number) || 0)} suffix="%" />
        </div>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <Button onClick={handleSave} loading={loading} color="teal" mt="md">
          {translate("Recalculate Pricing", "إعادة حساب التسعير")}
        </Button>
      </SectionCard>

      <SectionCard title={translate("Price Build", "تركيبة السعر")}>
        <Row label={translate("Materials & Site Costs (COGS)", "تكلفة المواد والموقع")} value={formatAmount(p.cogs, project.currency)} />
        <Row label={translate("Overhead", "النسبة العامة")} value={formatAmount(p.overheadAmt, project.currency)} />
        <Row label={translate("Contingency", "الاحتياطي")} value={formatAmount(p.contingencyAmt, project.currency)} />
        <Row label={translate("Profit", "الربح")} value={formatAmount(p.profitAmt, project.currency)} />
        <Row label={translate("Sales Bonus", "مكافأة المبيعات")} value={formatAmount(p.salesBonusAmt, project.currency)} />
        <Row label={translate("Engineering Incentive", "حافز الهندسة")} value={formatAmount(p.engineeringIncentiveAmt, project.currency)} />
        <Row label={translate("Category Addition", "إضافة الفئة")} value={formatAmount(p.categoryAdditionAmt, project.currency)} />
        <Row label={translate("Discount", "الخصم")} value={`-${formatAmount(p.discountAmt, project.currency)}`} />
        <Row label={translate("NET PRICE (excl. VAT)", "السعر الصافي (قبل الضريبة)")} value={formatAmount(p.netExclVat, project.currency)} bold />
        <Row label={`${translate("VAT", "الضريبة")} (${(p.vatPct * 100).toFixed(0)}%)`} value={formatAmount(p.vatAmt, project.currency)} />
        <Row label={translate("FINAL PRICE (incl. VAT)", "السعر النهائي (شامل الضريبة)")} value={formatAmount(p.grossInclVat, project.currency)} bold />
        <Row label={translate("Price per kWp (excl. VAT)", "السعر لكل كيلوواط")} value={formatAmount(p.perKwpExclVat, project.currency)} />
        <Row label={translate("Gross Profit", "إجمالي الربح")} value={`${formatAmount(p.grossProfit, project.currency)} (${p.grossProfitPct != null ? (p.grossProfitPct * 100).toFixed(1) : "-"}%)`} />
      </SectionCard>
    </div>
  );
}
