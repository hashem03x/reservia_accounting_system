import { useEffect, useState } from "react";
import { Button, Switch, TextInput } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import Modal from "@/components/ui/modal";
import ErrorAlert from "@/components/ui/error-alert";
import handleRequest from "@/utils/helpers/handle-request";
import { Sector, SectorInput } from "@/types/sector";

/** Create (sector = null) or edit a Sector's name and status. */
export default function SectorModal({
  opened,
  close,
  sector,
  onSubmit,
}: {
  opened: boolean;
  close: () => void;
  sector: Sector | null;
  onSubmit: (input: SectorInput) => Promise<unknown>;
}) {
  const { translate, language } = useLanguage();
  const isEdit = !!sector;

  const [name, setName] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Re-seed the form every time the modal opens (for a new sector or a different one).
  useEffect(() => {
    if (!opened) return;
    setName(sector?.name ?? "");
    setIsActive(sector?.isActive ?? true);
    setError("");
  }, [opened, sector]);

  const trimmedName = name.trim();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading || !trimmedName) return; // no double submission, no blank names
    handleRequest(language, setLoading, setError, async () => {
      await onSubmit({ name: trimmedName, isActive });
      close();
    });
  }

  return (
    <Modal
      opened={opened}
      onClose={() => !loading && close()}
      title={isEdit ? translate("Edit Sector", "تعديل القطاع") : translate("Create Sector", "إنشاء قطاع")}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error && <ErrorAlert error={error} />}

        <TextInput
          label={translate("Name", "الاسم")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
          required
          data-autofocus
        />
        <Switch
          label={translate("Active", "نشط")}
          description={translate(
            "Inactive sectors stay on existing projects but cannot be selected for a project.",
            "القطاعات غير النشطة تبقى على المشاريع الحالية لكن لا يمكن اختيارها لمشروع.",
          )}
          checked={isActive}
          onChange={(e) => setIsActive(e.currentTarget.checked)}
        />

        <div className="mt-2 flex justify-end gap-2">
          <Button variant="default" onClick={close} disabled={loading}>
            {translate("Cancel", "إلغاء")}
          </Button>
          <Button type="submit" color="cyan" loading={loading} disabled={!trimmedName}>
            {isEdit ? translate("Save", "حفظ") : translate("Create", "إنشاء")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
