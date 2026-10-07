import { useState } from "react";
import { useNavigate } from "react-router-dom";
import apiRequest from "@/utils/helpers/api-request";
import paths from "@/utils/constants/paths";
import handleRequest from "@/utils/helpers/handle-request";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useFetchingStatus from "@/hooks/useFetchingStatus";
import AuthForm from "@/pages/outer/components/auth-form";
import { validationRegex } from "@/utils/validations";
import { useLanguage } from "@/context/LanguageContext";
import { TextInput } from "@mantine/core";

export default function ForgotPassword() {
  const { language, translate, translations } = useLanguage();

  const title = translate("Forgot Password?", "نسيت كلمة المرور؟");

  useDocumentTitle(`${title} | ${translations.appName}`);

  const navigate = useNavigate();

  const [email, setEmail] = useState<string>("");

  const isValidEmail = validationRegex.email.test(email);

  const requiredFields = { email };

  const { loading, setLoading, error, setError } = useFetchingStatus();

  return (
    <AuthForm
      title={title}
      submitLabel={translate("Continue", "متابعة")}
      leave={{ to: `/${paths.login}`, label: translate("Back to Login", "العودة لتسجيل الدخول"), hint: "" }}
      requiredFields={requiredFields}
      isValidated={isValidEmail}
      loading={loading}
      error={error}
      onSubmit={(event) => {
        event.preventDefault();
        handleRequest(language, setLoading, setError, async () => {
          await apiRequest({
            method: "POST",
            url: "auth/forgotPassword",
            data: { email },
            language,
          });
          navigate(`/${paths.verifyCode}`, { state: { email } });
        });
      }}
    >
      <p className="text-center">
        {translate("Please enter your email address below.", "الرجاء إدخال عنوان بريدك الإلكتروني أدناه.")}
      </p>
      <TextInput
        required
        type="email"
        placeholder={translate("Your Email", "البريد الإلكتروني")}
        value={email}
        onChange={(e) => setEmail(e.currentTarget.value)}
        autoFocus
        size="lg"
      />
    </AuthForm>
  );
}
