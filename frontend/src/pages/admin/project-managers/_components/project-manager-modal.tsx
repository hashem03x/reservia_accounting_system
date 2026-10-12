import { useEffect, useState } from "react";
import { Button, Switch, TextInput } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import Modal from "@/components/ui/modal";
import ErrorAlert from "@/components/ui/error-alert";
import handleRequest from "@/utils/helpers/handle-request";
import { ProjectManager, ProjectManagerInput } from "@/types/project-manager";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[0-9 ()-]{5,30}$/;

/** Create (manager = null) or edit a Project Manager. */
export default function ProjectManagerModal({
  opened,
  close,
  manager,
  onSubmit,
}: {
  opened: boolean;
  close: () => void;
  manager: ProjectManager | null;
  onSubmit: (input: ProjectManagerInput) => Promise<unknown>;
}) {
  const { translate, language } = useLanguage();
  const isEdit = !!manager;

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Re-seed the form every time the modal opens (for a new project manager or a different one).
  useEffect(() => {
    if (!opened) return;
    setName(manager?.name ?? "");
    setEmail(manager?.email ?? "");
    setPhone(manager?.phone ?? "");
    setIsActive(manager?.isActive ?? true);
    setError("");
  }, [opened, manager]);

  const trimmedName = name.trim();
  const emailError =
    email.trim() && !EMAIL.test(email.trim()) ? translate("Invalid email address", "بريد إلكتروني غير صالح") : undefined;
  const phoneError =
    phone.trim() && !PHONE.test(phone.trim()) ? translate("Invalid phone number", "رقم هاتف غير صالح") : undefined;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading || !trimmedName || emailError || phoneError) return;
    handleRequest(language, setLoading, setError, async () => {
      await onSubmit({ name: trimmedName, email: email.trim() || null, phone: phone.trim() || null, isActive });
      close();
    });
  }

  return (
    <Modal
      opened={opened}
      onClose={() => !loading && close()}
      title={
        isEdit
          ? translate("Edit Project Manager", "تعديل مدير المشروع")
          : translate("Add Project Manager", "إضافة مدير مشروع")
      }
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
        <TextInput
          label={translate("Email", "البريد الإلكتروني")}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={emailError}
          maxLength={254}
          dir="ltr"
        />
        <TextInput
          label={translate("Phone", "الهاتف")}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          error={phoneError}
          maxLength={30}
          dir="ltr"
        />
        <Switch
          label={translate("Active", "نشط")}
          description={translate(
            "Inactive project managers stay on their projects but cannot be selected for a project.",
            "مديرو المشروعات غير النشطين يبقون على مشروعاتهم لكن لا يمكن اختيارهم لمشروع.",
          )}
          checked={isActive}
          onChange={(e) => setIsActive(e.currentTarget.checked)}
        />

        <div className="mt-2 flex justify-end gap-2">
          <Button variant="default" onClick={close} disabled={loading}>
            {translate("Cancel", "إلغاء")}
          </Button>
          <Button type="submit" color="cyan" loading={loading} disabled={!trimmedName || !!emailError || !!phoneError}>
            {isEdit ? translate("Save", "حفظ") : translate("Create", "إنشاء")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
