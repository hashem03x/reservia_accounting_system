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
  const [annualConsumptionKwh, setAnnualConsumptionKwh] = useState<number | "">((input.annualConsumptionKwh as number) || "");

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler<null>({ initialData: null });

  function handleSubmit() {
    handleRequest(language, setLoading, setError, async () => {
      if (!kWp || !pvModuleModel) throw new Error(translate("Capacity and PV module are required.", "القدرة ونوع الوحدة الشمسية مطلوبان."));
      const engineeringInput = {
        kWp, pvModuleModel, structureType, acLengthM,
        modulesPerStringOverride: modulesPerStringOverride || undefined,
        annualConsumptionKwh: annualConsumptionKwh || undefined,
      };
      const url = revision ? `commercial/revisions/${revision._id}` : `commercial/revisions/project/${project._id}`;
      await privateRequest({ url, method: revision ? "PATCH" : "POST", data: { engineeringInput }, language });
      onSaved();
    });
  }

  return (
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
        <NumberInput
          label={translate("Annual Electricity Consumption (kWh, optional)", "الاستهلاك السنوي للكهرباء (كيلوواط ساعة، اختياري)")}
          description={translate("Only needed to run the Feasibility tab", "مطلوب فقط لتشغيل تبويب الجدوى")}
          value={annualConsumptionKwh}
          onChange={(v) => setAnnualConsumptionKwh((v as number) || "")}
        />
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <Button onClick={handleSubmit} loading={loading} color="teal" mt="md">
        {revision ? translate("Recalculate", "إعادة الحساب") : translate("Calculate & Create Revision", "حساب وإنشاء النسخة")}
      </Button>
    </SectionCard>
  );
}
