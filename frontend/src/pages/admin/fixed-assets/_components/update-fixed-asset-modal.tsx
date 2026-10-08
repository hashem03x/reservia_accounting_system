import { useEffect, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { FixedAsset, FixedAssetStatus } from "@/types/fixed-asset";
import { Button, Select, Textarea, TextInput } from "@mantine/core";
import ErrorAlert from "@/components/ui/error-alert";
import Modal from "@/components/ui/modal";
import { useFixedAssetStatusLabel } from "./status";

// Only the descriptive fields and the status can change - cost, accounts, vendor and useful life
// are fixed once the acquisition entry is posted.
export default function UpdateFixedAssetModal({
  opened,
  close,
  asset,
  onUpdated,
}: {
  opened: boolean;
  close: () => void;
  asset: FixedAsset;
  onUpdated: (asset: FixedAsset) => void;
}) {
  const { language, translate } = useLanguage();
  const statusLabel = useFixedAssetStatusLabel();

  const [name, setName] = useState(asset.name);
  const [notes, setNotes] = useState(asset.notes || "");
  const [status, setStatus] = useState<FixedAssetStatus>(asset.status || "active");

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  useEffect(() => {
    if (!opened) return;
    setName(asset.name);
    setNotes(asset.notes || "");
    setStatus(asset.status || "active");
    setError("");
  }, [opened, asset]);

  const settable: FixedAssetStatus[] = ["active", "under_maintenance", "disposed"];

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    handleRequest(language, setLoading, setError, async () => {
      const res = await privateRequest({
        language,
        method: "PATCH",
        url: `fixed-assets/${asset._id}`,
        // A fully depreciated asset keeps that status unless it is disposed / put under maintenance.
        data: { name, notes, ...(status !== asset.status ? { status } : {}) },
      });
      onUpdated(res.data);
      close();
    });
  }

  return (
    <Modal opened={opened} onClose={close} title={translate("Edit Fixed Asset", "تعديل الأصل الثابت")}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error && <ErrorAlert error={error} />}
        <TextInput label={translate("Asset Name", "اسم الأصل")} value={name} onChange={(e) => setName(e.target.value)} required />
        <Select
          label={translate("Status", "الحالة")}
          value={status}
          onChange={(v) => v && setStatus(v as FixedAssetStatus)}
          data={[...new Set<FixedAssetStatus>([status, ...settable])].map((s) => ({ value: s, label: statusLabel(s), disabled: !settable.includes(s) }))}
        />
        <Textarea label={translate("Notes", "ملاحظات")} value={notes} onChange={(e) => setNotes(e.target.value)} autosize minRows={2} />
        <Button type="submit" loading={loading} disabled={!name}>
          {translate("Save", "حفظ")}
        </Button>
      </form>
    </Modal>
  );
}
