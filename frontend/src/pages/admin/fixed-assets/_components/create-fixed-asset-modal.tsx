import { useLanguage } from "@/context/LanguageContext";
import { useWarehouses } from "@/context/WarehousesContext";
import Modal from "@/components/ui/modal";
import ErrorAlert from "@/components/ui/error-alert";
import { Button, NumberInput, Select, TextInput } from "@mantine/core";
import { useState } from "react";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { FixedAsset } from "@/types/fixed-asset";
import { PaginatedData } from "@/types/global";

export default function CreateFixedAssetModal({
  opened,
  close,
  setPaginatedAssets,
}: {
  opened: boolean;
  close: () => void;
  setPaginatedAssets: React.Dispatch<React.SetStateAction<PaginatedData<FixedAsset>>>;
}) {
  const { translate, language } = useLanguage();
  const { data: warehouses } = useWarehouses();

  const [name, setName] = useState("");
  const [bookValue, setBookValue] = useState<string | number>("");
  const [fairValue, setFairValue] = useState<string | number>("");
  const [warehouseId, setWarehouseId] = useState("");

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    handleRequest(language, setLoading, setError, async () => {
      const res = await privateRequest({
        language,
        method: "POST",
        url: "fixed-assets",
        data: {
          name,
          bookValue,
          fairValue,
          warehouseId,
        },
      });

      // Update the data
      setPaginatedAssets((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          data: [res.data, ...prev.data],
        };
      });

      close();
    });
  }

  function handleClose() {
    close();
    setTimeout(() => {
      setName("");
      setBookValue("");
      setFairValue("");
      setWarehouseId("");
      setError("");
    }, 250);
  }

  const title = translate("Create Fixed Asset", "إنشاء أصل ثابت");

  return (
    <Modal opened={opened} onClose={handleClose} title={title} size="lg">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {/* Error Alert */}
        {error && <ErrorAlert error={error} />}

        {/* Name */}
        <TextInput
          label={translate("Asset Name", "اسم الأصل")}
          placeholder={translate("Enter asset name", "أدخل اسم الأصل")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />

        {/* Book Value */}
        <NumberInput
          label={translate("Book Value", "القيمة الدفترية")}
          placeholder={translate("Enter book value", "أدخل القيمة الدفترية")}
          value={bookValue}
          onChange={(value) => setBookValue(value)}
          min={0}
          required
        />

        {/* Fair Value */}
        <NumberInput
          label={translate("Fair Value", "القيمة العادلة")}
          placeholder={translate("Enter fair value", "أدخل القيمة العادلة")}
          value={fairValue}
          onChange={(value) => setFairValue(value)}
          min={0}
          required
        />

        {/* Warehouse */}
        <Select
          label={translate("Warehouse", "المخزن")}
          placeholder={translate("Select Warehouse", "اختر المخزن")}
          value={warehouseId}
          onChange={(value) => setWarehouseId(value || "")}
          data={warehouses.map((warehouse) => ({ value: warehouse._id, label: warehouse.name }))}
          required
        />

        {/* Submit Button */}
        <Button type="submit" loading={loading} mt="md">
          {translate("Create", "إنشاء")}
        </Button>
      </form>
    </Modal>
  );
}
