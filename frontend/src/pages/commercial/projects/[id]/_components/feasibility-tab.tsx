import { useLanguage } from "@/context/LanguageContext";
import { formatAmount } from "@/utils/helpers/format-amount";
import SectionCard from "@/components/ui/section-card";
import EmptySection from "@/components/ui/sections/empty";
import { CommercialProject, CommercialRevision } from "@/types/commercial";

type OnGridFeasibility = {
  headline: { payback: { label: string } | null; roi: number; irr: number | null };
  scenarios: {
    flat: { finalCumulative: number };
    escalation3pct: { finalCumulative: number };
    escalation10pct: { finalCumulative: number };
  };
};
type DieselComparison = {
  headline: { written: string; roi: number; irr: number | null; npv: number; twentyFiveYearNetSavings: number };
};

// Displays whichever feasibility model actually applies (On_Grid.xlsx `Feasibility Table` or
// Off_Grid.xlsx `Feasibility Study` diesel comparison) - Agriculture Pumping has NEITHER (no
// financial sheet exists in Solar_Pumping3.xlsx), so this tab says so rather than inventing one.
export default function FeasibilityTab({ project, revision }: { project: CommercialProject; revision: CommercialRevision }) {
  const { translate } = useLanguage();
  const feasibility = revision.feasibility as OnGridFeasibility | null;
  const diesel = revision.dieselComparison as DieselComparison | null;
  const engineeringInput = (revision.engineeringInput || {}) as Record<string, number>;
  const escalationScenario2 = engineeringInput.escalationScenario2 ?? 0.03;
  const escalationScenario3 = engineeringInput.escalationScenario3 ?? 0.1;
  const discountRatePct = ((engineeringInput.discountRate ?? 0.1) * 100).toFixed(0);
  const analysisPeriodYears = engineeringInput.analysisPeriodYears ?? 25;

  if (!feasibility && !diesel) {
    return (
      <EmptySection
        useDefaultImg
        message={
          project.category === "Agriculture Pumping"
            ? translate("Solar_Pumping3.xlsx has no financial feasibility worksheet - none is modeled here.", "لا يوجد نموذج جدوى مالية في ملف الضخ الزراعي المرجعي.")
            : translate("Enter the feasibility inputs on the Engineering Input tab to see this.", "أدخل مدخلات الجدوى في تبويب المدخلات الفنية لعرض هذا التبويب.")
        }
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {feasibility && (
        <SectionCard title={translate("Grid-Tariff Feasibility (On_Grid.xlsx)", "جدوى مالية مقابل تعريفة الشبكة")}>
          <Metric label={translate("Simple Payback", "فترة الاسترداد البسيطة")} value={feasibility.headline.payback?.label || "-"} />
          <Metric label={translate("ROI (25-year)", "العائد على الاستثمار (25 سنة)")} value={`${(feasibility.headline.roi * 100).toFixed(1)}%`} />
          <Metric label={translate("IRR", "معدل العائد الداخلي")} value={feasibility.headline.irr != null ? `${(feasibility.headline.irr * 100).toFixed(1)}%` : "-"} />
          <p className="mt-3 text-xs text-gray-400">
            {translate(
              "Headline figures use the flat (no-escalation) tariff scenario, the literal 25-year degradation table, and the raw BOQ cost as CapEx - exactly as On_Grid.xlsx computes it.",
              "يستخدم سيناريو التعريفة الثابتة وجدول التدهور الفعلي وتكلفة جدول الكميات كرأس مال، كما في ملف الإكسل الأصلي."
            )}
          </p>
          {feasibility.scenarios && (
            <div className="mt-3 border-t border-gray-100 pt-3">
              <p className="mb-1 text-xs font-semibold text-gray-500">
                {translate("25-Year Cumulative Cash Flow by Tariff Scenario", "صافي التدفق النقدي التراكمي على 25 سنة لكل سيناريو تعريفة")}
              </p>
              <Metric label={translate("Flat Tariff", "تعريفة ثابتة")} value={formatAmount(feasibility.scenarios.flat.finalCumulative, project.currency)} />
              <Metric
                label={translate(`+${(escalationScenario2 * 100).toFixed(0)}%/yr Escalation`, `تصاعد +${(escalationScenario2 * 100).toFixed(0)}%/سنة`)}
                value={formatAmount(feasibility.scenarios.escalation3pct.finalCumulative, project.currency)}
              />
              <Metric
                label={translate(`+${(escalationScenario3 * 100).toFixed(0)}%/yr Escalation`, `تصاعد +${(escalationScenario3 * 100).toFixed(0)}%/سنة`)}
                value={formatAmount(feasibility.scenarios.escalation10pct.finalCumulative, project.currency)}
              />
            </div>
          )}
        </SectionCard>
      )}
      {diesel && (
        <SectionCard title={translate("Solar vs. Diesel Generator (Off_Grid.xlsx)", "الطاقة الشمسية مقابل المولد الديزل")}>
          <Metric label={translate("Simple Payback", "فترة الاسترداد البسيطة")} value={diesel.headline.written} />
          <Metric label={translate(`ROI (${analysisPeriodYears}-year)`, `العائد على الاستثمار (${analysisPeriodYears} سنة)`)} value={`${(diesel.headline.roi * 100).toFixed(1)}%`} />
          <Metric label={translate("IRR", "معدل العائد الداخلي")} value={diesel.headline.irr != null ? `${(diesel.headline.irr * 100).toFixed(1)}%` : "-"} />
          <Metric label={translate(`NPV @ ${discountRatePct}%`, `صافي القيمة الحالية @ ${discountRatePct}%`)} value={formatAmount(diesel.headline.npv, project.currency)} />
          <Metric label={translate(`${analysisPeriodYears}-Year Net Savings`, `صافي التوفير على ${analysisPeriodYears} سنة`)} value={formatAmount(diesel.headline.twentyFiveYearNetSavings, project.currency)} />
        </SectionCard>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-gray-50 py-1.5 text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="font-semibold text-gray-800">{value}</span>
    </div>
  );
}
