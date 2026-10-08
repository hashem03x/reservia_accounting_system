import useFetchingStatus from "@/hooks/useFetchingStatus";
import { useLanguage } from "@/context/LanguageContext";
import { useUser } from "@/context/UserContext";
import apiRequest from "@/utils/helpers/api-request";
import extractUserInfo from "@/utils/helpers/extract-user-info";
import handleRequest from "@/utils/helpers/handle-request";
import { rememberUser } from "@/utils/helpers/local-storage";
import { CredentialResponse, GoogleLogin } from "@react-oauth/google";
import { notifyError } from "@/utils/helpers/notifiers";

export default function OAuth() {
  const { translate } = useLanguage();

  return (
    <div className="flex flex-col items-center">
      <p className="my-5">{translate("--- Or ---", "--- أو ---")}</p>
      <GoogleLoginButton />
    </div>
  );
}

function GoogleLoginButton() {
  const { language, translate } = useLanguage();
  const { setUser } = useUser();

  const { setLoading, setError, error } = useFetchingStatus();

  function handleSuccess(response: CredentialResponse) {
    handleRequest(language, setLoading, setError, async () => {
      const res = await apiRequest({
        method: "POST",
        url: "auth/oauth2/google",
        data: {
          credential: response.credential,
        },
        credentials: "include",
        language,
      });
      setUser(extractUserInfo(res));
      rememberUser();
    });
  }

  function handleError() {
    setError(translate("An error occurred while logging in", "حدث خطأ أثناء تسجيل الدخول"));
  }

  if (error) {
    notifyError({
      message: error,
      language,
    });
  }

  return (
    <div dir="ltr">
      <GoogleLogin onSuccess={handleSuccess} onError={handleError} shape="pill" size="medium" />
    </div>
  );
}

// =============================================================

// The next customized button doesn't return the credential needed so we need to use the default button
// import { useGoogleLogin } from "@react-oauth/google";
// import Image from "@/components/ui/img";
// import googleLogo from "@/assets/google.svg";

// function CustomGoogleButton() {
//   const { language } = useLanguage();
//   const login = useGoogleLogin({
//     onSuccess: (codeResponse) => console.log("Login Success:", codeResponse),
//     onError: (error) => console.log("Login Failed:", error),
//   });
//   return (
//     <button
//       className="flex-center w-full gap-2 rounded border p-2 text-gray-800 transition-colors hover:bg-gray-50"
//       style={{ fontWeight: 500 }}
//       onClick={() => login()}
//     >
//       <Image src={googleLogo} alt="Google" height="30px" />
//       {translate(language, "Login with Google", "تسجيل الدخول عبر جوجل")}
//     </button>
//   );
// }
