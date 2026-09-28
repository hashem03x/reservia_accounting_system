import { useLanguage } from "@/context/LanguageContext";
import Modal from "@/components/ui/modal";
import ErrorAlert from "@/components/ui/error-alert";
import { Button, NumberInput, TextInput } from "@mantine/core";
import { useState } from "react";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { FixedAsset } from "@/types/fixed-asset";
import { PaginatedData } from "@/types/global";

export default function UpdateFixedAssetModal({
  opened,
  close,
  asset,
  setPaginatedAssets,
}: {
  opened: boolean;
  close: () => void;
  asset: FixedAsset;
  setPaginatedAssets: React.Dispatch<React.SetStateAction<PaginatedData<FixedAsset>>>;
}) {
  const { translate, language } = useLanguage();

  const [name, setName] = useState(asset.name);
  const [fairValue, setFairValue] = useState<string | number>(asset.fairValue);

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    handleRequest(language, setLoading, setError, async () => {
      const res = await privateRequest({
        language,
        method: "PATCH",
        url: `fixed-assets/${asset._id}`,
        data: {
          name,
          fairValue,
        },
      });

      // Update the data
      setPaginatedAssets((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          data: prev.data.map((item) => (item._id === asset._id ? { ...item, ...res.data } : item)),
        };
      });

      close();
    });
  }

  function handleClose() {
    close();
    setTimeout(() => {
      setName(asset.name);
      setFairValue(asset.fairValue);
      setError("");
    }, 250);
  }

  const title = translate("Update Fixed Asset", "تحديث الأصل الثابت");

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

        {/* Fair Value */}
        <NumberInput
          label={translate("Fair Value", "القيمة العادلة")}
          placeholder={translate("Enter fair value", "أدخل القيمة العادلة")}
          value={fairValue}
          onChange={(value) => setFairValue(value)}
          min={0}
          required
        />

        {/* Submit Button */}
        <Button type="submit" loading={loading} mt="md">
          {translate("Update", "تحديث")}
        </Button>
      </form>
    </Modal>
  );
}
