import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import paths from "@/utils/constants/paths";
import handleRequest from "@/utils/helpers/handle-request";
import apiRequest from "@/utils/helpers/api-request";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useFetchingStatus from "@/hooks/useFetchingStatus";
import AuthForm from "@/pages/outer/components/auth-form";
import { useLanguage } from "@/context/LanguageContext";
import { PinInput } from "@mantine/core";

export default function VerifyCode() {
  const { language, translate, translations } = useLanguage();

  const title = translate("Verify Email", "تحقق من البريد الإلكتروني");

  useDocumentTitle(`${title} | ${translations.appName}`);

  const location = useLocation();
  const navigate = useNavigate();

  const email = location.state?.email;

  const [code, setCode] = useState<string>("");

  const requiredFields = { code };

  const { loading, setLoading, error, setError } = useFetchingStatus();

  // Accessing this page is not allowed if you didn't provide your email using the Forgot Password page
  if (!email) return <Navigate to={`/${paths.login}`} replace={true} />;

  return (
    <AuthForm
      title={title}
      leave={{ to: `/${paths.forgotPassword}`, label: translations.back, hint: "" }}
      requiredFields={requiredFields}
      isValidated={code.length === 6}
      loading={loading}
      error={error}
      submitLabel={translations.continue}
      onSubmit={(e) => {
        e.preventDefault();
        handleRequest(language, setLoading, setError, async () => {
          await apiRequest({
            method: "POST",
            url: "auth/verifyResetCode",
            data: { email, resetCode: code },
            language,
          });
          navigate(`/${paths.resetPassword}`, { state: { email } });
        });
      }}
    >
      <p className="text-center">
        {translate("Please enter the code we sent to your email.", "الرجاء إدخال الرمز الذي أرسلناه إلى بريدك الإلكتروني.")}
      </p>
      <div className="flex-center my-2">
        <PinInput value={code} onChange={setCode} length={6} size="lg" radius="md" variant="filled" autoFocus />
      </div>
    </AuthForm>
  );
}
