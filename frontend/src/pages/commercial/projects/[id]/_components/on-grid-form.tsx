import { useState } from "react";
import { Button, NumberInput, Select, TextInput } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import SectionCard from "@/components/ui/section-card";
import { CommercialProject, CommercialRevision } from "@/types/commercial";
import useMaterialOptions from "../../../_shared/useMaterialOptions";
import PctInput, { toPct } from "../../../_shared/PctInput";

const STRUCTURE_TYPES = ["Rooftop", "Ground Mounted", "Hangar Roof"];

// On-Grid / Utility Scale engineering inputs - services/commercial/onGridEngine.js#runOnGridDesign.
// The BOQ bills ceil(design kWp / module W) modules and measures every per-kWp line on the design
// kWp (QA findings section 4); the string layout is an engineering check shown on the BOQ tab.
// Feasibility inputs follow Developer Brief 3.4 with the QA U8 defaults: O&M 0% (in the EPC offer),
// headline escalation 10%, sensitivities 3% and flat.
export default function OnGridForm({ project, revision, onSaved }: { project: CommercialProject; revision: CommercialRevision | null; onSaved: () => void }) {
  const { translate, language } = useLanguage();
  const pvModules = useMaterialOptions("PV Modules");
  const dcCables = useMaterialOptions("DC Cable");
  const inverters = useMaterialOptions("On-Grid Inverter");
  const input = (revision?.engineeringInput || {}) as Record<string, unknown>;
  const n = (k: string) => (typeof input[k] === "number" ? (input[k] as number) : undefined);

  const [kWp, setKwp] = useState<number | "">(n("kWp") ?? 80);
  const [pvModuleModel, setPvModuleModel] = useState<string>((input.pvModuleModel as string) || "");
  const [structureType, setStructureType] = useState<string>((input.structureType as string) || "Hangar Roof");
  const [acLengthM, setAcLengthM] = useState<number | "">(n("acLengthM") ?? 20);
  const [acPricePerMOverride, setAcPricePerMOverride] = useState<number | "">(n("acPricePerMOverride") ?? "");
  const [dcCableBrand, setDcCableBrand] = useState<string>((input.dcCableBrand as string) || "");
  const [modulesPerStringOverride, setModulesPerStringOverride] = useState<number | "">(n("modulesPerStringOverride") ?? "");
  const [siteCrew, setSiteCrew] = useState<number | "">(n("siteCrew") ?? "");
  const [siteDays, setSiteDays] = useState<number | "">(n("siteDays") ?? "");
  // Deal Engine C3: blank = automatic (the smallest inverter giving DC/AC 1.10 to 1.30); a model forces it.
  const [inverterModel, setInverterModel] = useState<string>((input.inverterModel as string) || "");

  // Feasibility (brief 3.4). Legacy R74 inputs are mapped: escalationScenario3 (10%) -> headline.
  const legacyHeadline = n("escalationScenario3");
  const [annualConsumptionKwh, setAnnualConsumptionKwh] = useState<number | "">(n("annualConsumptionKwh") ?? "");
  // Deal Engine C8: blank tariff = bill / kWh when the bills are entered (else the 2.80 reference value).
  const [annualBillEgp, setAnnualBillEgp] = useState<number | "">(n("annualBillEgp") ?? "");
  const [tariffEgpPerKwh, setTariffEgpPerKwh] = useState<number | "">(n("tariffEgpPerKwh") ?? "");
  const [tariffNote, setTariffNote] = useState<string>((input.tariffNote as string) || "");
  const [headlineEscalation, setHeadlineEscalation] = useState<number>(toPct(n("headlineEscalation") ?? legacyHeadline ?? 0.1));
  const sens = Array.isArray(input.sensitivityEscalations) ? (input.sensitivityEscalations as number[]) : [0.03, 0];
  const [sensitivity1, setSensitivity1] = useState<number>(toPct(sens[0] ?? 0.03));
  const [sensitivity2, setSensitivity2] = useState<number>(toPct(sens[1] ?? 0));
  // Deal Engine C4: blank = the region's configured yield; a value is a per-site override with its source.
  const [yieldKwhPerKwp, setYieldKwhPerKwp] = useState<number | "">(n("yieldKwhPerKwp") ?? "");
  const [yieldSourceNote, setYieldSourceNote] = useState<string>((input.yieldSourceNote as string) || "");
  // Deal Engine C5 / C7.
  const [annualIrradiationKwhPerM2, setAnnualIrradiationKwhPerM2] = useState<number | "">(n("annualIrradiationKwhPerM2") ?? "");
  const [inverterReplacementYear, setInverterReplacementYear] = useState<number | "">(n("inverterReplacementYear") ?? "");
  const [degradationPct, setDegradationPct] = useState<number>(toPct(n("degradationPct") ?? 0.007));
  const [discountRate, setDiscountRate] = useState<number>(toPct(n("discountRate") ?? 0.22));
  // U8: O&M is included in the EPC offer - 0% unless the estimator deliberately enters a value.
  const [maintenancePctOfCapex, setMaintenancePctOfCapex] = useState<number>(toPct(input.headlineEscalation !== undefined ? (n("maintenancePctOfCapex") ?? 0) : 0));

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler<null>({ initialData: null });
  const dcBrands = Array.from(new Set(dcCables.map((c) => c.brand))).sort();

  function handleSubmit() {
    handleRequest(language, setLoading, setError, async () => {
      if (!kWp || !pvModuleModel) throw new Error(translate("Capacity and PV module are required.", "القدرة ونوع الوحدة الشمسية مطلوبان."));
      if ((siteCrew === "") !== (siteDays === "")) throw new Error(translate("Enter both crew size and days on site, or neither.", "أدخل عدد الطاقم وعدد الأيام معاً أو اتركهما فارغين."));
      if (yieldKwhPerKwp !== "" && !yieldSourceNote.trim()) throw new Error(translate("Say where the site yield comes from (PVsyst, PVGIS, measured...).", "اذكر مصدر الإنتاجية الخاصة بالموقع (PVsyst أو PVGIS أو قياس فعلي...)."));
      if (tariffEgpPerKwh !== "" && annualBillEgp !== "" && annualConsumptionKwh && !tariffNote.trim()) {
        throw new Error(translate("You typed a tariff although the bills are entered - add a note saying why.", "أدخلت تعريفة رغم إدخال الفواتير - أضف ملاحظة توضح السبب."));
      }
      const engineeringInput = {
        kWp, pvModuleModel, structureType, acLengthM,
        acPricePerMOverride: acPricePerMOverride === "" ? undefined : acPricePerMOverride,
        dcCableBrand: dcCableBrand || undefined,
        modulesPerStringOverride: modulesPerStringOverride || undefined,
        siteCrew: siteCrew === "" ? undefined : siteCrew,
        siteDays: siteDays === "" ? undefined : siteDays,
        annualConsumptionKwh: annualConsumptionKwh || undefined,
        tariffEgpPerKwh: tariffEgpPerKwh === "" ? undefined : tariffEgpPerKwh,
        annualBillEgp: annualBillEgp === "" ? undefined : annualBillEgp,
        tariffNote: tariffNote.trim() || undefined,
        yieldSourceNote: yieldSourceNote.trim() || undefined,
        annualIrradiationKwhPerM2: annualIrradiationKwhPerM2 === "" ? undefined : annualIrradiationKwhPerM2,
        inverterReplacementYear: inverterReplacementYear === "" ? undefined : inverterReplacementYear,
        inverterModel: inverterModel || undefined,
        headlineEscalation: headlineEscalation / 100,
        sensitivityEscalations: [sensitivity1 / 100, sensitivity2 / 100],
        yieldKwhPerKwp: yieldKwhPerKwp === "" ? undefined : yieldKwhPerKwp,
        degradationPct: degradationPct / 100,
        discountRate: discountRate / 100,
        maintenancePctOfCapex: maintenancePctOfCapex / 100,
      };
      const url = revision ? `commercial/revisions/${revision._id}` : `commercial/revisions/project/${project._id}`;
      await privateRequest({ url, method: revision ? "PATCH" : "POST", data: { engineeringInput }, language });
      onSaved();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <SectionCard title={translate("On-Grid Design Inputs", "مدخلات تصميم الربط بالشبكة")}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <NumberInput label={translate("Design Capacity (kWp)", "القدرة التصميمية (كيلوواط)")} description={translate("The BOQ, site costs and price per kWp are all measured on this.", "جدول الكميات وتكاليف الموقع والسعر لكل كيلوواط تُحسب على هذه القيمة.")} value={kWp} onChange={(v) => setKwp(v as number)} min={0.1} required />
          <Select
            label={translate("PV Module", "الوحدة الشمسية")}
            placeholder={translate("Select a module", "اختر وحدة")}
            data={pvModules.map((m) => ({ value: m.model, label: `${m.brand} ${m.model} (${m.n1}W)` }))}
            value={pvModuleModel || null}
            onChange={(v) => setPvModuleModel(v || "")}
            required
          />
          <Select label={translate("Mounting Structure", "نظام التثبيت")} data={STRUCTURE_TYPES} value={structureType} onChange={(v) => setStructureType(v || "Hangar Roof")} allowDeselect={false} />
          <NumberInput label={translate("AC Cable Length (m)", "طول كابل التيار المتردد (م)")} value={acLengthM} onChange={(v) => setAcLengthM(v as number)} min={1} />
          <NumberInput
            label={translate("AC Cable Price Override (EGP/m, optional)", "سعر كابل التيار المتردد (اختياري)")}
            description={translate("Used instead of the reference table price when entered (e.g. a supplier quote).", "يُستخدم بدلاً من سعر الجدول المرجعي عند إدخاله (مثل عرض مورد).")}
            value={acPricePerMOverride}
            onChange={(v) => setAcPricePerMOverride(v === "" ? "" : (v as number))}
            min={0}
          />
          <Select
            label={translate("DC Cable Brand (optional)", "ماركة كابل التيار المستمر (اختياري)")}
            description={translate("Blank = cheapest cable of the required size in the Price Book.", "فارغ = أرخص كابل بالمقاس المطلوب في قائمة الأسعار.")}
            data={dcBrands}
            value={dcCableBrand || null}
            onChange={(v) => setDcCableBrand(v || "")}
            clearable
          />
          <Select
            label={translate("Inverter (optional)", "العاكس (اختياري)")}
            description={translate("Blank = automatic: the smallest Price Book inverter giving DC/AC 1.10 to 1.30.", "فارغ = تلقائي: أصغر عاكس في قائمة الأسعار يعطي نسبة 1.10 إلى 1.30.")}
            data={inverters.map((m) => ({ value: m.model, label: `${m.brand} ${m.model} (${m.n1} kW)` }))}
            value={inverterModel || null}
            onChange={(v) => setInverterModel(v || "")}
            clearable
            searchable
            data-testid="inverter-override"
          />
          <NumberInput
            label={translate("Modules per String (optional override)", "عدد الوحدات في كل سلسلة (اختياري)")}
            description={translate("String layout is an engineering check only - it never changes the BOQ module quantity.", "تخطيط السلاسل للمراجعة الهندسية فقط - لا يغير كمية الوحدات في جدول الكميات.")}
            value={modulesPerStringOverride}
            onChange={(v) => setModulesPerStringOverride((v as number) || "")}
          />
        </div>
      </SectionCard>

      <SectionCard title={translate("Site Costs - optional", "تكاليف الموقع - اختياري")}>
        <p className="mb-3 text-sm text-gray-500">
          {translate(
            "Travel, hotel and per diem apply outside Greater Cairo; the personnel allowance applies everywhere (300 EGP per person-day). Leave both blank to price without site personnel costs.",
            "السفر والفندق والبدل اليومي خارج القاهرة الكبرى؛ بدل الأفراد في كل المناطق (300 جنيه للفرد يومياً). اتركهما فارغين للتسعير بدون تكاليف الأفراد."
          )}
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <NumberInput label={translate("Crew size", "عدد الطاقم")} value={siteCrew} onChange={(v) => setSiteCrew(v === "" ? "" : (v as number))} min={0} />
          <NumberInput label={translate("Days on site", "أيام العمل في الموقع")} value={siteDays} onChange={(v) => setSiteDays(v === "" ? "" : (v as number))} min={0} />
        </div>
      </SectionCard>

      <SectionCard title={translate("Customer Feasibility Inputs", "مدخلات جدوى العميل")}>
        <p className="mb-3 text-sm text-gray-500">
          {translate(
            "CapEx is always the final price incl. VAT from the Pricing tab. The headline case uses the escalation below; the two sensitivity scenarios are shown alongside.",
            "رأس المال دائماً هو السعر النهائي شامل الضريبة من تبويب التسعير. الحالة الرئيسية تستخدم التصاعد أدناه مع سيناريوهين للحساسية."
          )}
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <NumberInput
            label={translate("Annual electricity bills (EGP)", "إجمالي فواتير الكهرباء السنوية (جنيه)")}
            description={translate("With the annual kWh, sets the tariff = bills / kWh.", "مع الاستهلاك السنوي تُحسب التعريفة = الفواتير / ك.و.س.")}
            value={annualBillEgp}
            onChange={(v) => setAnnualBillEgp(v === "" ? "" : (v as number))}
            min={0}
            data-testid="annual-bill"
          />
          <NumberInput
            label={translate("Electricity Tariff (EGP/kWh, optional)", "تعريفة الكهرباء (اختياري)")}
            description={translate("Blank = from the bills (2.80 reference value without bills).", "فارغ = من الفواتير (2.80 قيمة مرجعية بدون فواتير).")}
            value={tariffEgpPerKwh}
            onChange={(v) => setTariffEgpPerKwh(v === "" ? "" : (v as number))}
            min={0}
            step={0.01}
            decimalScale={4}
          />
          <PctInput label={translate("Headline tariff escalation (%/yr)", "تصاعد التعريفة الرئيسي (%/سنة)")} value={headlineEscalation} onChange={setHeadlineEscalation} />
          <NumberInput label={translate("Annual consumption (kWh, optional)", "الاستهلاك السنوي (اختياري)")} description={translate("Used for the coverage figure only.", "لنسبة التغطية فقط.")} value={annualConsumptionKwh} onChange={(v) => setAnnualConsumptionKwh((v as number) || "")} />
          <PctInput label={translate("Sensitivity 1 escalation (%/yr)", "حساسية 1 (%/سنة)")} value={sensitivity1} onChange={setSensitivity1} />
          <PctInput label={translate("Sensitivity 2 escalation (%/yr)", "حساسية 2 (%/سنة)")} value={sensitivity2} onChange={setSensitivity2} />
          <NumberInput
            label={translate("Specific yield (kWh/kWp/yr, optional)", "الإنتاجية النوعية (اختياري)")}
            description={translate("Blank = the region's configured value. A value here is a site override.", "فارغ = القيمة المضبوطة للمنطقة. أي قيمة هنا خاصة بالموقع.")}
            value={yieldKwhPerKwp}
            onChange={(v) => setYieldKwhPerKwp(v === "" ? "" : (v as number))}
            min={0}
          />
          <PctInput label={translate("Degradation (%/yr)", "التدهور السنوي (%)")} value={degradationPct} onChange={setDegradationPct} />
          <NumberInput
            label={translate("Annual in-plane irradiation (kWh/m2, optional)", "الإشعاع السنوي على مستوى الألواح (اختياري)")}
            description={translate("Shows the performance ratio on the Design tab.", "يُظهر نسبة الأداء في تبويب التصميم.")}
            value={annualIrradiationKwhPerM2}
            onChange={(v) => setAnnualIrradiationKwhPerM2(v === "" ? "" : (v as number))}
            min={0}
          />
          <NumberInput
            label={translate("Inverter replacement year (optional)", "سنة استبدال العاكس (اختياري)")}
            description={translate("Blank = the configured year (13). Cost = today's Price Book inverter price.", "فارغ = السنة المضبوطة (13). التكلفة = سعر العاكس الحالي.")}
            value={inverterReplacementYear}
            onChange={(v) => setInverterReplacementYear(v === "" ? "" : (v as number))}
            min={1}
            max={25}
          />
          <PctInput label={translate("Discount rate for NPV (%)", "معدل الخصم لصافي القيمة الحالية (%)")} value={discountRate} onChange={setDiscountRate} />
          <PctInput
            label={translate("O&M deduction (% of CapEx/yr)", "خصم التشغيل والصيانة (% سنوياً)")}
            description={translate("0% - O&M is included in the EPC offer.", "0% - التشغيل والصيانة مشمولة في عرض EPC.")}
            value={maintenancePctOfCapex}
            onChange={setMaintenancePctOfCapex}
          />
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {yieldKwhPerKwp !== "" && (
            <TextInput
              label={translate("Source of the site yield (required)", "مصدر الإنتاجية الخاصة بالموقع (مطلوب)")}
              placeholder={translate("e.g. PVsyst simulation, PVGIS, measured", "مثال: محاكاة PVsyst أو PVGIS أو قياس فعلي")}
              value={yieldSourceNote}
              onChange={(e) => setYieldSourceNote(e.target.value)}
              maxLength={200}
            />
          )}
          {tariffEgpPerKwh !== "" && annualBillEgp !== "" && (
            <TextInput
              label={translate("Why the tariff differs from the bills (required)", "سبب اختلاف التعريفة عن الفواتير (مطلوب)")}
              value={tariffNote}
              onChange={(e) => setTariffNote(e.target.value)}
              maxLength={300}
            />
          )}
        </div>
      </SectionCard>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button onClick={handleSubmit} loading={loading} color="teal" className="self-start">
        {revision ? translate("Recalculate", "إعادة الحساب") : translate("Calculate & Create Revision", "حساب وإنشاء النسخة")}
      </Button>
    </div>
  );
}
