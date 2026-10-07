import { useState } from "react";
import { useUser } from "@/context/UserContext";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import extractUserInfo from "@/utils/helpers/extract-user-info";
import { Alert, Button, PasswordInput } from "@mantine/core";
import { solidIcons } from "@/components/icons";
import ErrorAlert from "@/components/ui/error-alert";
import Modal from "@/components/ui/modal";
import { validationRegex } from "@/utils/validations";

export default function EditPasswordModal({ opened, close }: { opened: boolean; close: () => void }) {
  const { language, translate } = useLanguage();

  const { setUser } = useUser();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const isValidNewPassword = validationRegex.password.test(newPassword);
  const isValidConfirmPassword = newPassword === confirmPassword;

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  const [success, setSuccess] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (newPassword !== confirmPassword) {
      setError(translate("Passwords do not match", "كلمات المرور غير متطابقة"));
      return;
    }

    handleRequest(language, setLoading, setError, async () => {
      const data = await privateRequest({
        method: "put",
        url: "users/updateMyPassword",
        data: { currentPassword, password: newPassword, passwordConfirm: confirmPassword },
        language,
      });

      setSuccess(true);

      setUser(extractUserInfo(data));

      setTimeout(() => {
        handleClose();
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");

        setTimeout(() => setSuccess(false), 100);
      }, 2500);
    });
  }

  function handleClose() {
    setError("");
    close();
  }

  return (
    <Modal opened={opened} onClose={handleClose} title={translate("Change Password", "تغيير كلمة المرور")}>
      {success ? (
        <Alert variant="light" color="green" icon={<solidIcons.CheckCircle />}>
          {translate("Password changed successfully", "تم تغيير كلمة المرور بنجاح")}
        </Alert>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <PasswordInput
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.currentTarget.value)}
            label={translate("Current Password", "كلمة المرور الحالية")}
            placeholder={translate("Current Password", "كلمة المرور الحالية")}
            required
          />
          <PasswordInput
            value={newPassword}
            onChange={(e) => setNewPassword(e.currentTarget.value)}
            label={translate("New Password", "كلمة المرور الجديدة")}
            placeholder={translate("New Password", "كلمة المرور الجديدة")}
            error={
              newPassword && !isValidNewPassword
                ? translate("Password should be at least 8 characters long.", "يجب أن تكون كلمة المرور من 8 أحرف على الأقل.")
                : null
            }
            required
          />
          <PasswordInput
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.currentTarget.value)}
            label={translate("Confirm Password", "تأكيد كلمة المرور")}
            placeholder={translate("Confirm Password", "تأكيد كلمة المرور")}
            error={
              confirmPassword && !isValidConfirmPassword
                ? translate("Passwords do not match.", "كلمات المرور غير متطابقة.")
                : null
            }
            required
          />

          <div className="flex gap-2">
            <Button
              fullWidth
              type="submit"
              loading={loading}
              disabled={!currentPassword || !isValidNewPassword || !isValidConfirmPassword}
            >
              {translate("Save", "حفظ")}
            </Button>
            <Button variant="light" fullWidth color="dark" onClick={handleClose}>
              {translate("Cancel", "إلغاء")}
            </Button>
          </div>

          {error && <ErrorAlert error={error} />}
        </form>
      )}
    </Modal>
  );
}
