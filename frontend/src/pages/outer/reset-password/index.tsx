import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import paths from "@/utils/constants/paths";
import { validationRegex } from "@/utils/validations";
import apiRequest from "@/utils/helpers/api-request";
import handleRequest from "@/utils/helpers/handle-request";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useFetchingStatus from "@/hooks/useFetchingStatus";
import AuthForm from "@/pages/outer/components/auth-form";
import { solidIcons } from "@/components/icons";
import { PasswordInput } from "@mantine/core";

export default function ResetPassword() {
  const { language, translate, translations } = useLanguage();

  const title = translate("Reset Password", "إعادة تعيين كلمة المرور");

  useDocumentTitle(`${title} | ${translations.appName}`);

  const location = useLocation();
  const navigate = useNavigate();

  const email = location.state?.email;

  const [newPassword, setNewPassord] = useState<string>("");
  const [confirmNewPassword, setConfirmNewPassword] = useState<string>("");

  const isValidNewPassword = validationRegex.password.test(newPassword);
  const isValidConfirmNewPassword = confirmNewPassword === newPassword;

  const requiredFields = { newPassword, confirmNewPassword };

  const { loading, setLoading, error, setError } = useFetchingStatus();

  const [success, setSuccess] = useState<boolean>(false);

  // Accessing this page is not allowed if you didn't provide your email using the Forgot Password page
  if (!email) return <Navigate to={`/${paths.login}`} replace={true} />;

  return success ? (
    <SuccessMessage />
  ) : (
    <AuthForm
      title={title}
      requiredFields={requiredFields}
      isValidated={isValidNewPassword && isValidConfirmNewPassword}
      loading={loading}
      error={error}
      submitLabel={title}
      onSubmit={(e) => {
        e.preventDefault();
        handleRequest(language, setLoading, setError, async () => {
          await apiRequest({
            method: "PUT",
            url: "auth/resetPassword",
            data: { email, newPassword },
            language,
          });
          setSuccess(true); // Displays the success message
          setTimeout(() => navigate(`/${paths.login}`, { state: null }), 3500);
        });
      }}
    >
      <p className="text-center">
        {translate("Please enter your new password below.", "الرجاء إدخال كلمة المرور الجديدة أدناه.")}
      </p>
      <PasswordInput
        required
        placeholder={translate("New password", "كلمة المرور الجديدة")}
        value={newPassword}
        onChange={(e) => setNewPassord(e.currentTarget.value)}
        error={
          newPassword && !isValidNewPassword
            ? translate("Password should be at least 8 characters long.", "يجب أن تكون كلمة المرور من 8 أحرف على الأقل.")
            : null
        }
        size="md"
        autoFocus
      />
      <PasswordInput
        required
        placeholder={translate("Confirm new password", "تأكيد كلمة المرور الجديدة")}
        value={confirmNewPassword}
        onChange={(e) => setConfirmNewPassword(e.currentTarget.value)}
        error={
          confirmNewPassword && !isValidConfirmNewPassword
            ? translate("Passwords do not match.", "كلمات المرور غير متطابقة.")
            : null
        }
        size="md"
      />
    </AuthForm>
  );
}

function SuccessMessage() {
  const { translate } = useLanguage();

  return (
    <div className="root-flex-1 flex-center mx-auto w-[385px] max-w-full animate-fade-in flex-col gap-6 p-4 pb-20">
      <span className="flex-center h-28 w-28 rounded-full border text-3xl">
        <solidIcons.CheckCircle className="text-green-500" />
      </span>
      <h2 className="text-center">{translate("Password reset successful", "تمت إعادة تعيين كلمة المرور")}</h2>
      <p className="text-center">
        {translate(
          "You will be redirected to the login page in a few seconds.",
          "سيتم توجيهك إلى صفحة تسجيل الدخول خلال ثواني.",
        )}
      </p>
    </div>
  );
}
