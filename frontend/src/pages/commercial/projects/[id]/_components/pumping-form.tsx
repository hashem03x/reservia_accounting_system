import { useState } from "react";
import { ActionIcon, Button, NumberInput, Select, Table } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import SectionCard from "@/components/ui/section-card";
import { outlineIcons, solidIcons } from "@/components/icons";
import { CommercialProject, CommercialRevision } from "@/types/commercial";
import useMaterialOptions from "../../../_shared/useMaterialOptions";

type FieldCropRow = { areaFeddan: number; irrigationCode: number; intervalDays: number; sunHours: number };
type TreeRow = { areaFeddan: number; treeCode: number; intervalDays: number };

const IRRIGATION_METHODS = [{ value: "1", label: "Flood" }, { value: "2", label: "Drip" }, { value: "3", label: "Sprinkler" }];
const TREE_TYPES = [
  { value: "1", label: "Banana" }, { value: "2", label: "Olive" }, { value: "3", label: "Fig" }, { value: "4", label: "Palm" },
  { value: "5", label: "Grapes" }, { value: "6", label: "Citrus" }, { value: "7", label: "Pomegranate / Apple" },
];

// Agriculture Pumping engineering inputs - mirrors services/commercial/pumpingEngine.js's water
// demand + pump/motor/PV sizing chain exactly (Solar_Pumping3.xlsx `Agricultural Load`/`Design`).
export default function PumpingForm({ project, revision, onSaved }: { project: CommercialProject; revision: CommercialRevision | null; onSaved: () => void }) {
  const { translate, language } = useLanguage();
  const pvModules = useMaterialOptions("PV Modules");
  const input = (revision?.engineeringInput || {}) as Record<string, unknown>;

  const [fieldCropRows, setFieldCropRows] = useState<FieldCropRow[]>((input.fieldCropRows as FieldCropRow[]) || [{ areaFeddan: 20, irrigationCode: 1, intervalDays: 2, sunHours: 5 }]);
  const [treeRows, setTreeRows] = useState<TreeRow[]>((input.treeRows as TreeRow[]) || [{ areaFeddan: 30, treeCode: 7, intervalDays: 2 }]);
  const [waterLevelM, setWaterLevelM] = useState<number>((input.waterLevelM as number) || 60);
  const [safetyAllowanceM, setSafetyAllowanceM] = useState<number>((input.safetyAllowanceM as number) || 5);
  const [wellDepthM, setWellDepthM] = useState<number>((input.wellDepthM as number) || 60);
  const [pumpQty, setPumpQty] = useState<number>((input.pumpQty as number) || 1);
  const [pvModuleModel, setPvModuleModel] = useState<string>((input.pvModuleModel as string) || "JKM670N-66QL6-BDV");

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler<null>({ initialData: null });

  function handleSubmit() {
    handleRequest(language, setLoading, setError, async () => {
      const engineeringInput = { fieldCropRows, treeRows, waterLevelM, safetyAllowanceM, wellDepthM, pumpQty, pvModuleModel };
      const url = revision ? `commercial/revisions/${revision._id}` : `commercial/revisions/project/${project._id}`;
      await privateRequest({ url, method: revision ? "PATCH" : "POST", data: { engineeringInput }, language });
      onSaved();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <SectionCard
        title={translate("Field Crop Water Demand", "احتياج المياه - المحاصيل الحقلية")}
        action={<Button size="xs" variant="light" leftSection={<solidIcons.Plus />} onClick={() => setFieldCropRows((p) => [...p, { areaFeddan: 0, irrigationCode: 1, intervalDays: 2, sunHours: 5 }])}>{translate("Add", "إضافة")}</Button>}
      >
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{translate("Area (feddan)", "المساحة (فدان)")}</Table.Th>
              <Table.Th>{translate("Irrigation Method", "طريقة الري")}</Table.Th>
              <Table.Th>{translate("Interval (days)", "الفترة (أيام)")}</Table.Th>
              <Table.Th>{translate("Sun Hours", "ساعات الشمس")}</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {fieldCropRows.map((r, i) => (
              <Table.Tr key={i}>
                <Table.Td><NumberInput size="xs" value={r.areaFeddan} onChange={(v) => setFieldCropRows((p) => p.map((x, idx) => (idx === i ? { ...x, areaFeddan: (v as number) || 0 } : x)))} /></Table.Td>
                <Table.Td>
                  <Select size="xs" data={IRRIGATION_METHODS} value={String(r.irrigationCode)} onChange={(v) => setFieldCropRows((p) => p.map((x, idx) => (idx === i ? { ...x, irrigationCode: Number(v) || 1 } : x)))} />
                </Table.Td>
                <Table.Td><NumberInput size="xs" value={r.intervalDays} onChange={(v) => setFieldCropRows((p) => p.map((x, idx) => (idx === i ? { ...x, intervalDays: (v as number) || 1 } : x)))} /></Table.Td>
                <Table.Td><NumberInput size="xs" value={r.sunHours} onChange={(v) => setFieldCropRows((p) => p.map((x, idx) => (idx === i ? { ...x, sunHours: (v as number) || 1 } : x)))} /></Table.Td>
                <Table.Td>
                  <ActionIcon color="red" variant="subtle" onClick={() => setFieldCropRows((p) => p.filter((_, idx) => idx !== i))}>
                    <outlineIcons.Trash />
                  </ActionIcon>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </SectionCard>

      <SectionCard
        title={translate("Tree Water Demand", "احتياج المياه - الأشجار")}
        action={<Button size="xs" variant="light" leftSection={<solidIcons.Plus />} onClick={() => setTreeRows((p) => [...p, { areaFeddan: 0, treeCode: 1, intervalDays: 2 }])}>{translate("Add", "إضافة")}</Button>}
      >
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{translate("Area (feddan)", "المساحة (فدان)")}</Table.Th>
              <Table.Th>{translate("Tree Type", "نوع الشجرة")}</Table.Th>
              <Table.Th>{translate("Interval (days)", "الفترة (أيام)")}</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {treeRows.map((r, i) => (
              <Table.Tr key={i}>
                <Table.Td><NumberInput size="xs" value={r.areaFeddan} onChange={(v) => setTreeRows((p) => p.map((x, idx) => (idx === i ? { ...x, areaFeddan: (v as number) || 0 } : x)))} /></Table.Td>
                <Table.Td>
                  <Select size="xs" data={TREE_TYPES} value={String(r.treeCode)} onChange={(v) => setTreeRows((p) => p.map((x, idx) => (idx === i ? { ...x, treeCode: Number(v) || 1 } : x)))} />
                </Table.Td>
                <Table.Td><NumberInput size="xs" value={r.intervalDays} onChange={(v) => setTreeRows((p) => p.map((x, idx) => (idx === i ? { ...x, intervalDays: (v as number) || 1 } : x)))} /></Table.Td>
                <Table.Td>
                  <ActionIcon color="red" variant="subtle" onClick={() => setTreeRows((p) => p.filter((_, idx) => idx !== i))}>
                    <outlineIcons.Trash />
                  </ActionIcon>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </SectionCard>

      <SectionCard title={translate("Pumping System", "نظام الضخ")}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <NumberInput label={translate("Water Level / Pumping Depth (m)", "مستوى المياه / عمق الضخ (م)")} value={waterLevelM} onChange={(v) => setWaterLevelM((v as number) || 0)} />
          <NumberInput label={translate("Well Depth (m)", "عمق البئر (م)")} value={wellDepthM} onChange={(v) => setWellDepthM((v as number) || 0)} />
          <NumberInput label={translate("Safety Allowance (m)", "هامش الأمان (م)")} value={safetyAllowanceM} onChange={(v) => setSafetyAllowanceM((v as number) || 0)} />
          <NumberInput label={translate("Pump Drives (qty)", "عدد وحدات الضخ")} value={pumpQty} onChange={(v) => setPumpQty((v as number) || 1)} min={1} />
          <Select
            label={translate("PV Module", "الوحدة الشمسية")}
            data={pvModules.map((m) => ({ value: m.model, label: `${m.brand} ${m.model} (${m.n1}W)` }))}
            value={pvModuleModel || null}
            onChange={(v) => setPvModuleModel(v || "")}
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
