import { useState } from "react";
import paths from "@/utils/constants/paths";
import handleRequest from "@/utils/helpers/handle-request";
import extractUserInfo from "@/utils/helpers/extract-user-info";
import { rememberUser } from "@/utils/helpers/local-storage";
import apiRequest from "@/utils/helpers/api-request";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useFetchingStatus from "@/hooks/useFetchingStatus";
import { useUser } from "@/context/UserContext";
import AuthForm from "@/pages/outer/components/auth-form";
import { Checkbox, PasswordInput, TextInput } from "@mantine/core";
import { Link } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import Img from "@/components/ui/img";
import logo from "@/assets/logo_no_bg.png";

export default function Login() {
  const { language, translate, translations } = useLanguage();

  const title = translate("Login", "تسجيل الدخول");

  useDocumentTitle(`${title} | ${translations.appName}`);

  const { setUser } = useUser();

  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [remember, setRemember] = useState<boolean>(true);

  const requiredFields = { email, password };

  const { loading, setLoading, error, setError } = useFetchingStatus();

  return (
    <div style={{ height: "100vh" }} className="flex flex-col items-center">
      <div>
        <Img width='80px' height="80px" src={logo || ""} alt={translations.appName} className="rounded" />
      </div>
      <AuthForm
        title={title}
        submitLabel={translate("Login", "تسجيل الدخول")}
        requiredFields={requiredFields}
        loading={loading}
        error={error}
        onSubmit={(e) => {
          e.preventDefault();
          handleRequest(language, setLoading, setError, async () => {
            const data = await apiRequest({
              method: "POST",
              url: "auth/login",
              data: { email, password },
              credentials: "include",
              language,
            });
            setUser(extractUserInfo(data));
            remember && rememberUser();
          });
        }}
        withOAuth
      >
        <TextInput
          required
          type="email"
          placeholder={translate("Email", "البريد الإلكتروني")}
          value={email}
          onChange={(e) => setEmail(e.currentTarget.value)}
          autoFocus
          size="lg"
        />
        <PasswordInput
          required
          placeholder={translate("Password", "كلمة المرور")}
          value={password}
          onChange={(e) => setPassword(e.currentTarget.value)}
          size="lg"
        />
        <div className="flex items-center justify-between">
          <Checkbox label={translate("Remember me", "تذكرني")} checked={remember} onChange={() => setRemember(!remember)} />
          <Link to={`/${paths.forgotPassword}`} className="text-primary-600 hover:text-primary-700">
            {translate("Forgot password?", "نسيت كلمة المرور؟")}
          </Link>
        </div>
      </AuthForm>
    </div>
  );
}
