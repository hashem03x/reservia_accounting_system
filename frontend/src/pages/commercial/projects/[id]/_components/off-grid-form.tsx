import { useState } from "react";
import { ActionIcon, Button, NumberInput, Table } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import SectionCard from "@/components/ui/section-card";
import { outlineIcons, solidIcons } from "@/components/icons";
import { CommercialProject, CommercialRevision } from "@/types/commercial";

type Appliance = { description: string; qty: number; watts: number; hoursPerDay: number; daytimeHours: number };

const DEFAULT_APPLIANCES: Appliance[] = [
  { description: "Lighting", qty: 12, watts: 20, hoursPerDay: 18, daytimeHours: 6 },
  { description: "Air Conditioner", qty: 2, watts: 800, hoursPerDay: 16, daytimeHours: 6 },
  { description: "Refrigerator", qty: 1, watts: 400, hoursPerDay: 24, daytimeHours: 6 },
];

// Off-Grid engineering inputs - mirrors services/commercial/offGridEngine.js's
// `runOffGridDesign` input shape exactly (Off_Grid.xlsx `Load Assessment`/`Design`/`BOQ`).
// Unlike On-Grid, most Off-Grid materials are manually priced in the source workbook (confirmed
// in the implementation plan) - so this form asks for prices directly rather than pretending a
// Price Book lookup exists for them.
export default function OffGridForm({ project, revision, onSaved }: { project: CommercialProject; revision: CommercialRevision | null; onSaved: () => void }) {
  const { translate, language } = useLanguage();
  const input = (revision?.engineeringInput || {}) as Record<string, unknown>;

  const [appliances, setAppliances] = useState<Appliance[]>((input.appliances as Appliance[]) || DEFAULT_APPLIANCES);
  const [peakSunHours, setPeakSunHours] = useState<number>((input.peakSunHours as number) || 5.5);
  const [performanceFactor, setPerformanceFactor] = useState<number>((input.performanceFactor as number) || 0.8);
  const [moduleWattage, setModuleWattage] = useState<number>((input.moduleWattage as number) || 625);
  const [moduleUnitPrice, setModuleUnitPrice] = useState<number>((input.moduleUnitPrice as number) || 5375);
  const [autonomyNights, setAutonomyNights] = useState<number>((input.autonomyNights as number) || 1);
  const [depthOfDischarge, setDepthOfDischarge] = useState<number>((input.depthOfDischarge as number) || 1);
  const [systemEfficiency, setSystemEfficiency] = useState<number>((input.systemEfficiency as number) || 0.9);
  const [batteryUnitVoltage, setBatteryUnitVoltage] = useState<number>((input.batteryUnitVoltage as number) || 51.2);
  const [batteryUnitAh, setBatteryUnitAh] = useState<number>((input.batteryUnitAh as number) || 314);
  const [batteryUnitPrice, setBatteryUnitPrice] = useState<number>((input.batteryUnitPrice as number) || 105000);
  const [inverterAcRatingW, setInverterAcRatingW] = useState<number>((input.inverterAcRatingW as number) || 10000);
  const [maxPvInputW, setMaxPvInputW] = useState<number>((input.maxPvInputW as number) || 12000);
  const [inverterUnitPrice, setInverterUnitPrice] = useState<number>((input.inverterUnitPrice as number) || 92000);
  const [dcCablePricePerM, setDcCablePricePerM] = useState<number>((input.dcCablePricePerM as number) || 51);
  const [acLengthM, setAcLengthM] = useState<number>((input.acLengthM as number) || 20);
  const [acCablePricePerM, setAcCablePricePerM] = useState<number>((input.acCablePricePerM as number) || 110);
  const [mountingStructureRatePerKwp, setMountingStructureRatePerKwp] = useState<number>((input.mountingStructureRatePerKwp as number) || 2200);
  const [installationRatePerKwp, setInstallationRatePerKwp] = useState<number>((input.installationRatePerKwp as number) || 650);
  const [generatorPurchasePrice, setGeneratorPurchasePrice] = useState<number | "">((input.generatorPurchasePrice as number) || "");
  const [dieselPriceEgpPerL, setDieselPriceEgpPerL] = useState<number>((input.dieselPriceEgpPerL as number) || 20);
  // Feasibility Study!B12,B13,B14,B15,B16,B17,B18,B21,B22 - all genuine editable input cells in
  // Off_Grid.xlsx's own feasibility sheet, previously hardcoded as backend-only defaults with no
  // way for the commercial team to override them per project.
  const [dieselTransportEgpPerL, setDieselTransportEgpPerL] = useState<number>((input.dieselTransportEgpPerL as number) ?? 2);
  const [dieselAnnualEscalation, setDieselAnnualEscalation] = useState<number>(((input.dieselAnnualEscalation as number) ?? 0.025) * 100);
  const [generatorSpecificFuelUseLPerKwh, setGeneratorSpecificFuelUseLPerKwh] = useState<number>((input.generatorSpecificFuelUseLPerKwh as number) ?? 0.3);
  const [generatorMaintenancePct, setGeneratorMaintenancePct] = useState<number>(((input.generatorMaintenancePct as number) ?? 0.1) * 100);
  const [generatorReplacementIntervalYears, setGeneratorReplacementIntervalYears] = useState<number>((input.generatorReplacementIntervalYears as number) ?? 10);
  const [solarAnnualOmPct, setSolarAnnualOmPct] = useState<number>(((input.solarAnnualOmPct as number) ?? 0.025) * 100);
  const [batteryReplacementIntervalYears, setBatteryReplacementIntervalYears] = useState<number>((input.batteryReplacementIntervalYears as number) ?? 10);
  const [analysisPeriodYears, setAnalysisPeriodYears] = useState<number>((input.analysisPeriodYears as number) ?? 25);
  const [discountRate, setDiscountRate] = useState<number>(((input.discountRate as number) ?? 0.1) * 100);

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler<null>({ initialData: null });

  function updateAppliance(i: number, field: keyof Appliance, value: number | string) {
    setAppliances((prev) => prev.map((a, idx) => (idx === i ? { ...a, [field]: value } : a)));
  }

  function handleSubmit() {
    handleRequest(language, setLoading, setError, async () => {
      const engineeringInput = {
        appliances, peakSunHours, performanceFactor, moduleWattage, moduleUnitPrice,
        autonomyNights, depthOfDischarge, systemEfficiency, batteryUnitVoltage, batteryUnitAh, batteryUnitPrice,
        simultaneityFactor: 1, safetyMargin: 0.25, inverterAcRatingW, maxPvInputW, inverterUnitPrice,
        dcCablePricePerM, acLengthM, acCablePricePerM, mc4Pairs: 4, mc4PricePerPair: 90, dcProtectionPrice: 2500,
        mountingStructureRatePerKwp, earthingRatePerKwp: 100, miscRatePerKwp: { cableTrayPerM: 70, accessoriesPerKwp: 150 },
        installationRatePerKwp, transportationRatePerKwp: 500,
        contingencyRate: 0.02, profitMarginRate: 0.1, vatRate: project.country === "Saudi Arabia" ? 0.15 : 0.14,
        generatorPurchasePrice: generatorPurchasePrice || undefined, dieselPriceEgpPerL,
        dieselTransportEgpPerL, dieselAnnualEscalation: dieselAnnualEscalation / 100,
        generatorSpecificFuelUseLPerKwh, generatorMaintenancePct: generatorMaintenancePct / 100,
        generatorReplacementIntervalYears, solarAnnualOmPct: solarAnnualOmPct / 100,
        batteryReplacementIntervalYears, analysisPeriodYears, discountRate: discountRate / 100,
      };
      const url = revision ? `commercial/revisions/${revision._id}` : `commercial/revisions/project/${project._id}`;
      await privateRequest({ url, method: revision ? "PATCH" : "POST", data: { engineeringInput }, language });
      onSaved();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <SectionCard
        title={translate("Appliance Load Assessment", "تقييم الأحمال")}
        action={
          <Button size="xs" variant="light" leftSection={<solidIcons.Plus />} onClick={() => setAppliances((prev) => [...prev, { description: "", qty: 1, watts: 0, hoursPerDay: 0, daytimeHours: 0 }])}>
            {translate("Add", "إضافة")}
          </Button>
        }
      >
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{translate("Load", "الحمل")}</Table.Th>
              <Table.Th>{translate("Qty", "الكمية")}</Table.Th>
              <Table.Th>{translate("Power (W)", "القدرة (واط)")}</Table.Th>
              <Table.Th>{translate("Hours/day", "ساعات/يوم")}</Table.Th>
              <Table.Th>{translate("Daytime Hours", "ساعات النهار")}</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {appliances.map((a, i) => (
              <Table.Tr key={i}>
                <Table.Td>
                  <input className="w-full rounded border border-gray-200 px-2 py-1 text-sm" value={a.description} onChange={(e) => updateAppliance(i, "description", e.target.value)} />
                </Table.Td>
                <Table.Td><NumberInput size="xs" value={a.qty} onChange={(v) => updateAppliance(i, "qty", (v as number) || 0)} /></Table.Td>
                <Table.Td><NumberInput size="xs" value={a.watts} onChange={(v) => updateAppliance(i, "watts", (v as number) || 0)} /></Table.Td>
                <Table.Td><NumberInput size="xs" value={a.hoursPerDay} onChange={(v) => updateAppliance(i, "hoursPerDay", (v as number) || 0)} /></Table.Td>
                <Table.Td><NumberInput size="xs" value={a.daytimeHours} onChange={(v) => updateAppliance(i, "daytimeHours", (v as number) || 0)} /></Table.Td>
                <Table.Td>
                  <ActionIcon color="red" variant="subtle" onClick={() => setAppliances((prev) => prev.filter((_, idx) => idx !== i))}>
                    <outlineIcons.Trash />
                  </ActionIcon>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </SectionCard>

      <SectionCard title={translate("PV / Battery / Inverter Sizing", "حجم الألواح / البطاريات / العاكس")}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <NumberInput label={translate("Peak Sun Hours", "ساعات الشمس القصوى")} value={peakSunHours} onChange={(v) => setPeakSunHours((v as number) || 0)} step={0.1} />
          <NumberInput label={translate("PV Performance Factor", "معامل كفاءة الألواح")} value={performanceFactor} onChange={(v) => setPerformanceFactor((v as number) || 0)} step={0.05} />
          <NumberInput label={translate("Module Wattage (W)", "قدرة الوحدة (واط)")} value={moduleWattage} onChange={(v) => setModuleWattage((v as number) || 0)} />
          <NumberInput label={translate("Module Unit Price", "سعر الوحدة")} value={moduleUnitPrice} onChange={(v) => setModuleUnitPrice((v as number) || 0)} />
          <NumberInput label={translate("Autonomy (nights)", "أيام الاستقلالية")} value={autonomyNights} onChange={(v) => setAutonomyNights((v as number) || 0)} />
          <NumberInput label={translate("Depth of Discharge", "عمق التفريغ")} value={depthOfDischarge} onChange={(v) => setDepthOfDischarge((v as number) || 0)} step={0.05} />
          <NumberInput label={translate("Battery System Efficiency", "كفاءة نظام البطارية")} value={systemEfficiency} onChange={(v) => setSystemEfficiency((v as number) || 0)} step={0.05} />
          <NumberInput label={translate("Battery Unit Voltage (V)", "جهد وحدة البطارية")} value={batteryUnitVoltage} onChange={(v) => setBatteryUnitVoltage((v as number) || 0)} />
          <NumberInput label={translate("Battery Unit Capacity (Ah)", "سعة وحدة البطارية")} value={batteryUnitAh} onChange={(v) => setBatteryUnitAh((v as number) || 0)} />
          <NumberInput label={translate("Battery Unit Price", "سعر وحدة البطارية")} value={batteryUnitPrice} onChange={(v) => setBatteryUnitPrice((v as number) || 0)} />
          <NumberInput label={translate("Inverter AC Rating (W)", "قدرة العاكس")} value={inverterAcRatingW} onChange={(v) => setInverterAcRatingW((v as number) || 0)} />
          <NumberInput label={translate("Max PV Input (W)", "أقصى دخل للألواح")} value={maxPvInputW} onChange={(v) => setMaxPvInputW((v as number) || 0)} />
          <NumberInput label={translate("Inverter Unit Price", "سعر العاكس")} value={inverterUnitPrice} onChange={(v) => setInverterUnitPrice((v as number) || 0)} />
        </div>
      </SectionCard>

      <SectionCard title={translate("Cabling, Structure & Installation Rates", "الكابلات والتركيب")}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <NumberInput label={translate("DC Cable Price/m", "سعر كابل التيار المستمر/م")} value={dcCablePricePerM} onChange={(v) => setDcCablePricePerM((v as number) || 0)} />
          <NumberInput label={translate("AC Cable Length (m)", "طول كابل التيار المتردد")} value={acLengthM} onChange={(v) => setAcLengthM((v as number) || 0)} />
          <NumberInput label={translate("AC Cable Price/m", "سعر كابل التيار المتردد/م")} value={acCablePricePerM} onChange={(v) => setAcCablePricePerM((v as number) || 0)} />
          <NumberInput label={translate("Mounting Structure Rate/kWp", "سعر التثبيت/كيلوواط")} value={mountingStructureRatePerKwp} onChange={(v) => setMountingStructureRatePerKwp((v as number) || 0)} />
          <NumberInput
            label={translate("Installation Rate/kWp", "سعر التركيب/كيلوواط")}
            description={translate("Off_Grid.xlsx uses a flat 650, not the Egypt Rates matrix", "ملف خارج الشبكة يستخدم سعراً ثابتاً 650")}
            value={installationRatePerKwp}
            onChange={(v) => setInstallationRatePerKwp((v as number) || 0)}
          />
        </div>
      </SectionCard>

      <SectionCard title={translate("Feasibility Inputs - Diesel Generator Comparison (optional)", "مدخلات الجدوى - مقارنة المولد الديزل (اختياري)")}>
        <p className="mb-3 text-sm text-gray-500">
          {translate(
            "These values drive the Feasibility tab's solar-vs-diesel comparison only. Leave the purchase price blank to skip it.",
            "هذه القيم تغذي مقارنة الديزل في تبويب الجدوى فقط. اتركه فارغاً لتجاوز المقارنة."
          )}
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <NumberInput
            label={translate("Generator Purchase Price", "سعر شراء المولد")}
            description={translate("Leave blank to skip the Feasibility tab's diesel comparison", "اتركه فارغاً لتجاوز مقارنة الديزل")}
            value={generatorPurchasePrice}
            onChange={(v) => setGeneratorPurchasePrice((v as number) || "")}
          />
          <NumberInput label={translate("Diesel Price (EGP/L)", "سعر الديزل (جنيه/لتر)")} value={dieselPriceEgpPerL} onChange={(v) => setDieselPriceEgpPerL((v as number) || 0)} />
          <NumberInput
            label={translate("Diesel Transport/Delivery (EGP/L)", "نقل/توريد الديزل (جنيه/لتر)")}
            description={translate("Feasibility Study default: 2", "القيمة الافتراضية: 2")}
            value={dieselTransportEgpPerL}
            onChange={(v) => setDieselTransportEgpPerL((v as number) || 0)}
          />
          <NumberInput
            label={translate("Diesel Annual Escalation (%/yr)", "تصاعد سعر الديزل (%/سنة)")}
            description={translate("Feasibility Study default: 2.5%/yr", "القيمة الافتراضية: 2.5%/سنة")}
            value={dieselAnnualEscalation}
            onChange={(v) => setDieselAnnualEscalation((v as number) || 0)}
            suffix="%"
          />
          <NumberInput
            label={translate("Generator Specific Fuel Use (L/kWh)", "استهلاك الوقود النوعي (لتر/كيلوواط ساعة)")}
            description={translate("Feasibility Study default: 0.3", "القيمة الافتراضية: 0.3")}
            value={generatorSpecificFuelUseLPerKwh}
            onChange={(v) => setGeneratorSpecificFuelUseLPerKwh((v as number) || 0)}
            step={0.01}
            decimalScale={2}
          />
          <NumberInput
            label={translate("Generator Maintenance (%/yr of price)", "صيانة المولد (%/سنة من السعر)")}
            description={translate("Feasibility Study default: 10%/yr", "القيمة الافتراضية: 10%/سنة")}
            value={generatorMaintenancePct}
            onChange={(v) => setGeneratorMaintenancePct((v as number) || 0)}
            suffix="%"
          />
          <NumberInput
            label={translate("Generator Replacement Interval (yrs)", "فترة استبدال المولد (سنوات)")}
            description={translate("Feasibility Study default: 10", "القيمة الافتراضية: 10")}
            value={generatorReplacementIntervalYears}
            onChange={(v) => setGeneratorReplacementIntervalYears((v as number) || 1)}
          />
          <NumberInput
            label={translate("Solar Annual O&M (% of CapEx)", "تشغيل وصيانة الألواح (% من الاستثمار)")}
            description={translate("Feasibility Study default: 2.5%/yr", "القيمة الافتراضية: 2.5%/سنة")}
            value={solarAnnualOmPct}
            onChange={(v) => setSolarAnnualOmPct((v as number) || 0)}
            suffix="%"
          />
          <NumberInput
            label={translate("Battery Replacement Interval (yrs)", "فترة استبدال البطارية (سنوات)")}
            description={translate("Feasibility Study default: 10", "القيمة الافتراضية: 10")}
            value={batteryReplacementIntervalYears}
            onChange={(v) => setBatteryReplacementIntervalYears((v as number) || 1)}
          />
          <NumberInput
            label={translate("Analysis Period (yrs)", "فترة التحليل (سنوات)")}
            description={translate("Feasibility Study default: 25", "القيمة الافتراضية: 25")}
            value={analysisPeriodYears}
            onChange={(v) => setAnalysisPeriodYears((v as number) || 1)}
          />
          <NumberInput
            label={translate("Discount Rate (%)", "معدل الخصم (%)")}
            description={translate("Feasibility Study default: 10% (used for NPV)", "القيمة الافتراضية: 10% (لحساب القيمة الحالية الصافية)")}
            value={discountRate}
            onChange={(v) => setDiscountRate((v as number) || 0)}
            suffix="%"
          />
        </div>
      </SectionCard>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button onClick={handleSubmit} loading={loading} color="teal" className="self-start">
        {revision ? translate("Recalculate", "إعادة الحساب") : translate("Calculate & Create Revision", "حساب وإنشاء النسخة")}
      </Button>
    </div>
  );
}
