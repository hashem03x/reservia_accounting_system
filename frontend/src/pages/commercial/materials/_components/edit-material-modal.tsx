import { useEffect, useState } from "react";
import { Button, NumberInput } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import Modal from "@/components/ui/modal";
import { MaterialItem } from "@/types/commercial";

// Editing the price here APPENDS to the material's priceHistory (materialController.js), never
// overwrites it - a project revision that already resolved this item's price at an earlier value
// keeps that value, per the project's own "price updates never change an issued quotation" rule.
export default function EditMaterialModal({ opened, onClose, material, onSaved }: { opened: boolean; onClose: () => void; material: MaterialItem | null; onSaved: () => void }) {
  const { translate, language } = useLanguage();
  const [unitPrice, setUnitPrice] = useState<number>(0);
  const { privateRequest, loading, setLoading, error, setError } = useDataHandler<null>({ initialData: null });

  useEffect(() => {
    if (material) setUnitPrice(material.unitPrice);
  }, [material]);

  function handleSave() {
    if (!material) return;
    handleRequest(language, setLoading, setError, async () => {
      await privateRequest({ url: `commercial/materials/${material._id}`, method: "PATCH", data: { unitPrice }, language });
      onClose();
      onSaved();
    });
  }

  if (!material) return null;

  return (
    <Modal opened={opened} onClose={onClose} title={`${material.brand} ${material.model}`}>
      <div className="flex flex-col gap-3">
        <p className="text-xs text-gray-500">
          {translate("Source", "المصدر")}: {material.sourceWorkbook} - {material.sourceSheet}
        </p>
        <NumberInput label={translate("Unit Price", "سعر الوحدة")} value={unitPrice} onChange={(v) => setUnitPrice((v as number) || 0)} suffix={` ${material.currency}`} />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button onClick={handleSave} loading={loading} color="teal" fullWidth>
          {translate("Save", "حفظ")}
        </Button>
      </div>
    </Modal>
  );
}
