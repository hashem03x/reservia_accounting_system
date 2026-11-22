import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useUser } from "@/context/UserContext";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useLogout from "@/hooks/useLogout";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import extractUserInfo from "@/utils/helpers/extract-user-info";
import { validationRegex } from "@/utils/validations";
import { Alert, Button, PasswordInput } from "@mantine/core";
import { solidIcons } from "@/components/icons";
import ErrorAlert from "@/components/ui/error-alert";
import Img from "@/components/ui/img";
import logo from "@/assets/logo_no_bg.png";

// Feature 5 - a forced password change (Super Admin bootstrap, or any other forced-reset flow).
// Reuses the EXISTING self-service endpoint (PUT /users/updateMyPassword - see
// profile/components/change-password-modal.tsx, the normal, optional version of this same form) -
// no new backend endpoint. The ONLY difference here: no Cancel/dismiss, and AuthGaurd (not this
// page) is what actually blocks every other protected route until user.mustChangePassword clears,
// so there is nothing to bypass by closing or navigating away from this page itself.
export default function ForceChangePassword() {
  const { language, translate, translations } = useLanguage();
  const navigate = useNavigate();
  const { user, setUser } = useUser();
  const logout = useLogout();

  useDocumentTitle(`${translate("Change Your Password", "تغيير كلمة المرور")} | ${translations.appName}`);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const isValidNewPassword = validationRegex.password.test(newPassword);
  const isValidConfirmPassword = newPassword === confirmPassword;
  const sameAsCurrent = !!currentPassword && currentPassword === newPassword;

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setError(translate("Passwords do not match", "كلمات المرور غير متطابقة"));
      return;
    }
    if (sameAsCurrent) {
      setError(translate("Choose a new password different from the current one.", "اختر كلمة مرور جديدة مختلفة عن الحالية."));
      return;
    }
    handleRequest(language, setLoading, setError, async () => {
      // The real self-service change-password endpoint - clears mustChangePassword on success
      // (controller/user/userController.js#updateLoggedUserPassword) and returns the fresh user.
      const data = await privateRequest({
        method: "put",
        url: "users/updateMyPassword",
        data: { currentPassword, password: newPassword, passwordConfirm: confirmPassword },
        language,
      });
      setUser(extractUserInfo(data));
      navigate("/", { replace: true });
    });
  }

  return (
    <div style={{ height: "100vh" }} className="flex flex-col items-center">
      <div>
        <Img width="80px" height="80px" src={logo || ""} alt={translations.appName} className="rounded" />
      </div>
      <div className="root-flex-1 flex flex-col justify-center p-4 pb-20">
        <div className="mx-auto w-[450px] max-w-full animate-fade-in">
          <h1 className="mb-2 text-center">{translate("Change Your Password", "تغيير كلمة المرور")}</h1>
          <Alert color="yellow" variant="light" mb="md">
            {translate(
              "For security, you must set a new password before continuing.",
              "لأسباب أمنية، يجب تعيين كلمة مرور جديدة قبل الاستمرار."
            )}
          </Alert>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <PasswordInput
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.currentTarget.value)}
              label={translate("Current Password", "كلمة المرور الحالية")}
              placeholder={translate("Current Password", "كلمة المرور الحالية")}
              autoFocus
              required
            />
            <PasswordInput
              value={newPassword}
              onChange={(e) => setNewPassword(e.currentTarget.value)}
              label={translate("New Password", "كلمة المرور الجديدة")}
              placeholder={translate("New Password", "كلمة المرور الجديدة")}
              description={translate("At least 8 characters.", "٨ أحرف على الأقل.")}
              error={newPassword && !isValidNewPassword ? translate("Password should be at least 8 characters long.", "يجب أن تكون كلمة المرور من 8 أحرف على الأقل.") : null}
              required
            />
            <PasswordInput
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.currentTarget.value)}
              label={translate("Confirm Password", "تأكيد كلمة المرور")}
              placeholder={translate("Confirm Password", "تأكيد كلمة المرور")}
              error={confirmPassword && !isValidConfirmPassword ? translate("Passwords do not match.", "كلمات المرور غير متطابقة.") : null}
              required
            />
            <Button
              type="submit"
              size="md"
              loading={loading}
              disabled={!currentPassword || !isValidNewPassword || !isValidConfirmPassword || sameAsCurrent}
            >
              {loading ? <solidIcons.Spinner className="animate-spin" /> : translate("Change Password", "تغيير كلمة المرور")}
            </Button>
            {error && <ErrorAlert error={error} />}
          </form>
          <button
            type="button"
            onClick={() => logout()}
            className="mt-4 w-full text-center text-sm text-gray-500 hover:text-gray-700"
          >
            {translate("Sign out instead", "تسجيل الخروج بدلاً من ذلك")} ({user?.email})
          </button>
        </div>
      </div>
    </div>
  );
}
