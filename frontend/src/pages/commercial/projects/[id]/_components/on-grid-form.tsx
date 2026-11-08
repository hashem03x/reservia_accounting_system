import { useState } from "react";
import { Button, NumberInput, Select } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import SectionCard from "@/components/ui/section-card";
import { CommercialProject, CommercialRevision } from "@/types/commercial";
import useMaterialOptions from "../../../_shared/useMaterialOptions";

const STRUCTURE_TYPES = ["Rooftop", "Ground Mounted", "Hangar Roof"];

// On-Grid / Utility Scale engineering inputs - mirrors services/commercial/onGridEngine.js's
// `runOnGridDesign` input shape exactly (On_Grid.xlsx `Estimator Input`/`On-Grid Design`).
export default function OnGridForm({ project, revision, onSaved }: { project: CommercialProject; revision: CommercialRevision | null; onSaved: () => void }) {
  const { translate, language } = useLanguage();
  const pvModules = useMaterialOptions("PV Modules");
  const input = (revision?.engineeringInput || {}) as Record<string, number | string>;

  const [kWp, setKwp] = useState<number | "">((input.kWp as number) || 80);
  const [pvModuleModel, setPvModuleModel] = useState<string>((input.pvModuleModel as string) || "");
  const [structureType, setStructureType] = useState<string>((input.structureType as string) || "Hangar Roof");
  const [acLengthM, setAcLengthM] = useState<number | "">((input.acLengthM as number) || 20);
  const [modulesPerStringOverride, setModulesPerStringOverride] = useState<number | "">((input.modulesPerStringOverride as number) || "");

  // Feasibility Table!G4/C4/M7/T7 - genuine editable input cells in On_Grid.xlsx's own
  // feasibility sheet, surfaced here (not buried in the design grid above) since they only
  // affect the Feasibility tab and are meaningless to the BOQ/engineering design.
  const [annualConsumptionKwh, setAnnualConsumptionKwh] = useState<number | "">((input.annualConsumptionKwh as number) || "");
  const [tariffEgpPerKwh, setTariffEgpPerKwh] = useState<number | "">((input.tariffEgpPerKwh as number) ?? 2.8);
  const [maintenancePctOfCapex, setMaintenancePctOfCapex] = useState<number | "">(((input.maintenancePctOfCapex as number) ?? 0.01) * 100);
  const [escalationScenario2, setEscalationScenario2] = useState<number | "">(((input.escalationScenario2 as number) ?? 0.03) * 100);
  const [escalationScenario3, setEscalationScenario3] = useState<number | "">(((input.escalationScenario3 as number) ?? 0.1) * 100);

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler<null>({ initialData: null });

  function handleSubmit() {
    handleRequest(language, setLoading, setError, async () => {
      if (!kWp || !pvModuleModel) throw new Error(translate("Capacity and PV module are required.", "القدرة ونوع الوحدة الشمسية مطلوبان."));
      const engineeringInput = {
        kWp, pvModuleModel, structureType, acLengthM,
        modulesPerStringOverride: modulesPerStringOverride || undefined,
        annualConsumptionKwh: annualConsumptionKwh || undefined,
        tariffEgpPerKwh: tariffEgpPerKwh === "" ? undefined : tariffEgpPerKwh,
        maintenancePctOfCapex: maintenancePctOfCapex === "" ? undefined : maintenancePctOfCapex / 100,
        escalationScenario2: escalationScenario2 === "" ? undefined : escalationScenario2 / 100,
        escalationScenario3: escalationScenario3 === "" ? undefined : escalationScenario3 / 100,
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
          <NumberInput label={translate("Design Capacity (kWp)", "القدرة التصميمية (كيلوواط)")} value={kWp} onChange={(v) => setKwp(v as number)} min={0.1} required />
          <Select
            label={translate("PV Module", "الوحدة الشمسية")}
            placeholder={translate("Select a module", "اختر وحدة")}
            data={pvModules.map((m) => ({ value: m.model, label: `${m.brand} ${m.model} (${m.n1}W)` }))}
            value={pvModuleModel || null}
            onChange={(v) => setPvModuleModel(v || "")}
            required
          />
          <Select label={translate("Mounting Structure", "نظام التثبيت")} data={STRUCTURE_TYPES} value={structureType} onChange={(v) => setStructureType(v || "Hangar Roof")} />
          <NumberInput label={translate("AC Cable Length (m)", "طول كابل التيار المتردد (م)")} value={acLengthM} onChange={(v) => setAcLengthM(v as number)} min={1} />
          <NumberInput
            label={translate("Modules per String (optional override)", "عدد الوحدات في كل سلسلة (اختياري)")}
            description={translate("Leave blank to use the suggested series limit", "اتركه فارغاً لاستخدام الحد المقترح")}
            value={modulesPerStringOverride}
            onChange={(v) => setModulesPerStringOverride((v as number) || "")}
          />
        </div>
      </SectionCard>

      <SectionCard title={translate("Feasibility Inputs", "مدخلات الجدوى")}>
        <p className="mb-3 text-sm text-gray-500">
          {translate(
            "These values drive the Feasibility tab only - they have no effect on the engineering design or BOQ.",
            "هذه القيم تغذي تبويب الجدوى فقط - ولا تؤثر على التصميم الهندسي أو قائمة الكميات."
          )}
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <NumberInput
            label={translate("Annual Electricity Consumption (kWh)", "الاستهلاك السنوي للكهرباء (كيلوواط ساعة)")}
            description={translate("Leave blank to skip the Feasibility tab", "اتركه فارغاً لتجاهل تبويب الجدوى")}
            value={annualConsumptionKwh}
            onChange={(v) => setAnnualConsumptionKwh((v as number) || "")}
          />
          <NumberInput
            label={translate("Electricity Tariff (EGP/kWh)", "تعريفة الكهرباء (جنيه/كيلوواط ساعة)")}
            description={translate("Feasibility Table default: 2.80", "القيمة الافتراضية: 2.80")}
            value={tariffEgpPerKwh}
            onChange={(v) => setTariffEgpPerKwh((v as number) || "")}
            min={0}
            step={0.01}
            decimalScale={2}
          />
          <NumberInput
            label={translate("Annual Maintenance (% of CapEx)", "الصيانة السنوية (% من تكلفة الاستثمار)")}
            description={translate("Feasibility Table default: 1%", "القيمة الافتراضية: 1%")}
            value={maintenancePctOfCapex}
            onChange={(v) => setMaintenancePctOfCapex((v as number) || "")}
            min={0}
            suffix="%"
          />
          <NumberInput
            label={translate("Tariff Escalation - Scenario 2 (%/yr)", "تصاعد التعريفة - السيناريو 2 (%/سنة)")}
            description={translate("Feasibility Table default: 3%/yr", "القيمة الافتراضية: 3%/سنة")}
            value={escalationScenario2}
            onChange={(v) => setEscalationScenario2((v as number) || "")}
            min={0}
            suffix="%"
          />
          <NumberInput
            label={translate("Tariff Escalation - Scenario 3 (%/yr)", "تصاعد التعريفة - السيناريو 3 (%/سنة)")}
            description={translate("Feasibility Table default: 10%/yr", "القيمة الافتراضية: 10%/سنة")}
            value={escalationScenario3}
            onChange={(v) => setEscalationScenario3((v as number) || "")}
            min={0}
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
