import { Badge, Table } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import { formatAmount } from "@/utils/helpers/format-amount";
import SectionCard from "@/components/ui/section-card";
import EmptySection from "@/components/ui/sections/empty";
import { CommercialProject, CommercialRevision } from "@/types/commercial";

// Deal Engine C9: `escalation` is a yearly rate, or the two-phase path { first, years, then }.
type Scenario = {
  escalation: number | { first: number; years: number; then: number };
  label?: string;
  discountedPaybackLabel?: string;
  simpleCostPerKwh?: number | null;
  lcoePerKwh?: number | null;
  inverterReplacement?: { year: number; costEgp: number } | null;
  paybackYears: number | null;
  paybackLabel: string;
  irr: number | null;
  npv: number;
  lifetimeSavings: number;
  lifetimeGenerationKwh: number;
  year1GenerationKwh: number;
  year1Savings: number;
  levelisedCostPerKwh: number | null;
  years: { n: number; generationKwh: number; tariff: number; savings: number; inverterReplacement?: number; cumulative: number }[];
};
type CustomerFeasibility = {
  model: "brief-3.4";
  priceBasis: { netExclVat: number; vatPct: number; vatAmt: number; grossInclVat: number; capex: number; capexBasis: string };
  assumptions: {
    yieldKwhPerKwp: number; degradationPct: number; tariffEgpPerKwh: number; headlineEscalation: number; discountRate: number; maintenancePctOfCapex: number; designKwp: number; omIncludedInEpc: boolean;
    yieldSource?: "site" | "region" | "default" | null; yieldBasis?: string | null; tariffSource?: "bill" | "manual" | "manual-override" | "default" | null; tariffNote?: string | null; annualBillEgp?: number | null;
  };
  performance?: { annualIrradiationKwhPerM2: number | null; performanceRatio: number | null; status: "pending" | "computed" };
  annualConsumptionKwh: number | null;
  year1CoverageOfConsumption: number | null;
  headline: Scenario;
  sensitivities: Scenario[];
  internalCostView: { capex: number; paybackYears: number | null; paybackLabel: string; label: string } | null;
};
type DieselComparison = {
  headline: { written: string; roi: number; irr: number | null; npv: number; twentyFiveYearNetSavings: number };
  years: { n: number; netSavings: number }[];
};

const pct = (v: number | null | undefined, dp = 1) => (v != null ? `${(v * 100).toFixed(dp)}%` : "-");
const num = (v: number) => Math.round(v).toLocaleString("en-US");

// Customer feasibility (QA findings B4/U8; Developer Brief 3.4): capex = the FINAL PRICE incl VAT the
// customer pays, headline case 10% tariff escalation with 3% and flat sensitivities, no O&M deducted
// (O&M is in the EPC offer). The price basis is shown so the link to the Pricing tab is visible.
// Off-Grid shows the Off_Grid.xlsx solar-vs-diesel comparison (also on the final price).
export default function FeasibilityTab({ project, revision }: { project: CommercialProject; revision: CommercialRevision }) {
  const { translate } = useLanguage();
  const raw = revision.feasibility as (CustomerFeasibility & { model?: string }) | null;
  const feasibility = raw && raw.model === "brief-3.4" ? raw : null;
  const legacy = raw && !feasibility;
  const diesel = revision.dieselComparison as DieselComparison | null;
  const cur = project.currency;
  const ei = (revision.engineeringInput || {}) as Record<string, number>;

  if (!feasibility && !diesel) {
    return (
      <EmptySection
        useDefaultImg
        message={
          project.category === "Agriculture Pumping"
            ? translate("Solar_Pumping3.xlsx has no financial feasibility worksheet - none is modeled here.", "لا يوجد نموذج جدوى مالية في ملف الضخ الزراعي المرجعي.")
            : legacy
              ? translate("This revision was calculated with the old cost-basis model - recalculate it on the Engineering Input tab to see the customer feasibility on the final price.", "تم حساب هذه النسخة بالنموذج القديم - أعد الحساب لعرض الجدوى على السعر النهائي.")
              : project.category === "Off-Grid"
                ? translate("Enter the generator price on the Engineering Input tab to compare against diesel.", "أدخل سعر المولد في تبويب المدخلات الفنية للمقارنة مع الديزل.")
                : translate("Recalculate the revision to see the feasibility.", "أعد حساب النسخة لعرض الجدوى.")
        }
      />
    );
  }

  const Metric = ({ label, value, strong }: { label: string; value: string; strong?: boolean }) => (
    <div className="flex justify-between gap-3 border-b border-gray-50 py-1.5 text-sm">
      <span className="text-gray-500">{label}</span>
      <span className={strong ? "font-bold text-gray-900" : "font-semibold text-gray-800"}>{value}</span>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {feasibility && (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <SectionCard title={translate("Price basis (from the Pricing tab)", "أساس السعر (من تبويب التسعير)")}>
              <Metric label={translate("Net price excl. VAT", "السعر الصافي قبل الضريبة")} value={formatAmount(feasibility.priceBasis.netExclVat, cur)} />
              <Metric label={`${translate("VAT", "الضريبة")} (${pct(feasibility.priceBasis.vatPct, 0)})`} value={formatAmount(feasibility.priceBasis.vatAmt, cur)} />
              <Metric label={translate("Final price incl. VAT", "السعر النهائي شامل الضريبة")} value={formatAmount(feasibility.priceBasis.grossInclVat, cur)} />
              <Metric label={translate("CapEx used (year 0)", "رأس المال المستخدم (السنة 0)")} value={formatAmount(feasibility.priceBasis.capex, cur)} strong />
              <p className="pt-1 text-xs text-gray-400">{translate("CapEx = final price incl. VAT - what the customer actually pays.", "رأس المال = السعر النهائي شامل الضريبة - ما يدفعه العميل فعلياً.")}</p>
            </SectionCard>

            <SectionCard title={`${translate("Headline case", "الحالة الرئيسية")}: +${pct(feasibility.headline.escalation as number, 0)} ${translate("tariff escalation / yr", "تصاعد التعريفة / سنة")}`}>
              <Metric label={translate("Simple payback", "فترة الاسترداد")} value={feasibility.headline.paybackLabel} strong />
              {feasibility.headline.discountedPaybackLabel && (
                <Metric label={`${translate("Discounted payback", "فترة الاسترداد المخصومة")} @ ${pct(feasibility.assumptions.discountRate, 0)}`} value={feasibility.headline.discountedPaybackLabel} />
              )}
              <Metric label={translate("IRR (25 years)", "معدل العائد الداخلي (25 سنة)")} value={pct(feasibility.headline.irr)} />
              <Metric label={`${translate("NPV", "صافي القيمة الحالية")} @ ${pct(feasibility.assumptions.discountRate, 0)}`} value={formatAmount(feasibility.headline.npv, cur)} />
              <Metric label={translate("25-year avoided cost", "الوفر على 25 سنة")} value={formatAmount(feasibility.headline.lifetimeSavings, cur)} />
              {/* Deal Engine C6: the undiscounted ratio is not an LCOE - it is labelled as what it is. */}
              <Metric
                label={translate("Simple cost per kWh (price / 25-year generation, undiscounted)", "التكلفة البسيطة لكل ك.و.س (السعر / إنتاج 25 سنة، بدون خصم)")}
                value={(feasibility.headline.simpleCostPerKwh ?? feasibility.headline.levelisedCostPerKwh) != null ? `${(feasibility.headline.simpleCostPerKwh ?? feasibility.headline.levelisedCostPerKwh)!.toFixed(3)} ${cur}` : "-"}
              />
              {feasibility.headline.lcoePerKwh != null && (
                <Metric label={`LCOE (${translate("discounted at", "مخصوم بمعدل")} ${pct(feasibility.assumptions.discountRate, 0)})`} value={`${feasibility.headline.lcoePerKwh.toFixed(3)} ${cur}`} />
              )}
            </SectionCard>

            <SectionCard title={translate("Generation & assumptions", "الإنتاج والافتراضات")}>
              <Metric label={translate("Design capacity", "القدرة التصميمية")} value={`${feasibility.assumptions.designKwp} kWp`} />
              <Metric label={translate("Year-1 generation", "إنتاج السنة الأولى")} value={`${num(feasibility.headline.year1GenerationKwh)} kWh`} />
              <Metric label={translate("Year-1 savings", "وفر السنة الأولى")} value={formatAmount(feasibility.headline.year1Savings, cur)} />
              <Metric
                label={translate("Specific yield", "الإنتاجية النوعية")}
                value={`${num(feasibility.assumptions.yieldKwhPerKwp)} kWh/kWp${feasibility.assumptions.yieldSource ? ` - ${feasibility.assumptions.yieldSource === "site" ? translate("site value", "قيمة الموقع") : translate("region default", "قيمة المنطقة")}` : ""}`}
              />
              {feasibility.assumptions.yieldBasis && <p className="-mt-1 mb-1 text-xs text-gray-500">{feasibility.assumptions.yieldBasis}</p>}
              <Metric label={translate("Degradation", "التدهور السنوي")} value={`${pct(feasibility.assumptions.degradationPct)} / ${translate("yr", "سنة")}`} />
              <Metric
                label={translate("Tariff (year 1)", "التعريفة (السنة 1)")}
                value={`${feasibility.assumptions.tariffEgpPerKwh.toFixed(2)} ${cur}/kWh${
                  feasibility.assumptions.tariffSource === "bill"
                    ? ` - ${translate("from the bills", "من الفواتير")}`
                    : feasibility.assumptions.tariffSource === "default"
                      ? ` - ${translate("reference value, no bills entered", "قيمة مرجعية بدون فواتير")}`
                      : feasibility.assumptions.tariffSource
                        ? ` - ${translate("entered by the estimator", "أدخلها المسؤول")}`
                        : ""
                }`}
              />
              {feasibility.assumptions.tariffNote && <p className="-mt-1 mb-1 text-xs text-gray-500">{feasibility.assumptions.tariffNote}</p>}
              {feasibility.performance && (
                <Metric
                  label={translate("Performance ratio (IEC 61724-1)", "نسبة الأداء (IEC 61724-1)")}
                  value={feasibility.performance.performanceRatio != null ? pct(feasibility.performance.performanceRatio, 1) : translate("Pending - enter the in-plane irradiation", "قيد الانتظار - أدخل الإشعاع")}
                />
              )}
              {feasibility.headline.inverterReplacement && (
                <Metric
                  label={translate("Inverter replacement", "استبدال العاكس")}
                  value={`${translate("Year", "السنة")} ${feasibility.headline.inverterReplacement.year}: ${formatAmount(feasibility.headline.inverterReplacement.costEgp, cur)}`}
                />
              )}
              <Metric
                label={translate("O&M", "التشغيل والصيانة")}
                value={feasibility.assumptions.omIncludedInEpc ? translate("Included in the EPC offer (0%)", "مشمولة في عرض EPC (0%)") : `${pct(feasibility.assumptions.maintenancePctOfCapex)} ${translate("of CapEx / yr", "من رأس المال / سنة")}`}
              />
              {feasibility.year1CoverageOfConsumption != null && (
                <Metric label={translate("Year-1 coverage of consumption", "تغطية الاستهلاك في السنة 1")} value={`${pct(feasibility.year1CoverageOfConsumption, 0)} ${translate("of", "من")} ${num(feasibility.annualConsumptionKwh!)} kWh`} />
              )}
            </SectionCard>
          </div>

          <SectionCard title={translate("Tariff escalation scenarios", "سيناريوهات تصاعد التعريفة")}>
            <Table striped>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{translate("Scenario", "السيناريو")}</Table.Th>
                  <Table.Th>{translate("Payback", "الاسترداد")}</Table.Th>
                  <Table.Th>IRR</Table.Th>
                  <Table.Th>NPV</Table.Th>
                  <Table.Th>{translate("25-year savings", "الوفر على 25 سنة")}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {[feasibility.headline, ...feasibility.sensitivities].map((s, i) => (
                  <Table.Tr key={typeof s.escalation === "number" ? s.escalation : `two-phase-${i}`}>
                    <Table.Td>
                      {s.label || (s.escalation === 0 ? translate("Flat tariff (0%)", "تعريفة ثابتة (0%)") : `+${pct(s.escalation as number, 0)} / ${translate("yr", "سنة")}`)}{" "}
                      {i === 0 ? <Badge size="xs" variant="light" color="teal">{translate("Headline", "رئيسي")}</Badge> : <Badge size="xs" variant="light" color="gray">{translate("Sensitivity", "حساسية")}</Badge>}
                    </Table.Td>
                    <Table.Td>
                      {s.paybackLabel}
                      {s.discountedPaybackLabel && <div className="text-xs text-gray-500">{translate("discounted", "مخصوم")}: {s.discountedPaybackLabel}</div>}
                    </Table.Td>
                    <Table.Td>{pct(s.irr)}</Table.Td>
                    <Table.Td>{formatAmount(s.npv, cur)}</Table.Td>
                    <Table.Td>{formatAmount(s.lifetimeSavings, cur)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
            {feasibility.internalCostView && (
              <p className="mt-3 rounded bg-gray-50 p-2 text-xs text-gray-500">
                {translate("Internal cost-side check only - not the customer case", "مراجعة داخلية لجانب التكلفة فقط - ليست حالة العميل")}: {translate("payback on the raw BOQ cost", "الاسترداد على تكلفة جدول الكميات")} ({formatAmount(feasibility.internalCostView.capex, cur)}) = {feasibility.internalCostView.paybackLabel}.
              </p>
            )}
          </SectionCard>

          <SectionCard title={translate("Year-by-year (headline case)", "سنة بسنة (الحالة الرئيسية)")}>
            <div className="max-h-80 overflow-auto">
              <Table striped stickyHeader>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{translate("Year", "السنة")}</Table.Th>
                    <Table.Th>{translate("Generation (kWh)", "الإنتاج (ك.و.س)")}</Table.Th>
                    <Table.Th>{translate("Tariff", "التعريفة")}</Table.Th>
                    <Table.Th>{translate("Savings", "الوفر")}</Table.Th>
                    <Table.Th>{translate("Inverter replacement", "استبدال العاكس")}</Table.Th>
                    <Table.Th>{translate("Cumulative", "التراكمي")}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  <Table.Tr>
                    <Table.Td>0</Table.Td>
                    <Table.Td>-</Table.Td>
                    <Table.Td>-</Table.Td>
                    <Table.Td>-</Table.Td>
                    <Table.Td>-</Table.Td>
                    <Table.Td className="text-red-600">{formatAmount(-feasibility.priceBasis.capex, cur)}</Table.Td>
                  </Table.Tr>
                  {feasibility.headline.years.map((y) => (
                    <Table.Tr key={y.n}>
                      <Table.Td>{y.n}</Table.Td>
                      <Table.Td>{num(y.generationKwh)}</Table.Td>
                      <Table.Td>{y.tariff.toFixed(2)}</Table.Td>
                      <Table.Td>{formatAmount(y.savings, cur)}</Table.Td>
                      <Table.Td className={y.inverterReplacement ? "text-red-600" : "text-gray-300"}>{y.inverterReplacement ? formatAmount(-y.inverterReplacement, cur) : "-"}</Table.Td>
                      <Table.Td className={y.cumulative < 0 ? "text-red-600" : "text-teal-700"}>{formatAmount(y.cumulative, cur)}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </div>
          </SectionCard>
        </>
      )}
      {diesel && (
        <SectionCard title={translate("Solar vs. Diesel Generator (Off_Grid.xlsx) - solar CapEx = final price incl. VAT", "الطاقة الشمسية مقابل المولد - رأس المال = السعر النهائي")}>
          <Metric label={translate("Solar CapEx used (final price incl. VAT)", "رأس مال الطاقة الشمسية (السعر النهائي)")} value={formatAmount(revision.pricing?.grossInclVat, cur)} />
          <Metric label={translate("Simple Payback", "فترة الاسترداد البسيطة")} value={diesel.headline.written} strong />
          <Metric label={translate("ROI", "العائد على الاستثمار")} value={pct(diesel.headline.roi)} />
          <Metric label={translate("IRR", "معدل العائد الداخلي")} value={pct(diesel.headline.irr)} />
          <Metric label={`NPV @ ${pct(ei.discountRate ?? 0.1, 0)}`} value={formatAmount(diesel.headline.npv, cur)} />
          <Metric label={translate("Net savings over the period", "صافي الوفر خلال الفترة")} value={formatAmount(diesel.headline.twentyFiveYearNetSavings, cur)} />
        </SectionCard>
      )}
    </div>
  );
}
