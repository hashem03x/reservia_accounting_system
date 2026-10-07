import { useUser } from "@/context/UserContext";
import { useLanguage } from "@/context/LanguageContext";
import apiRequest from "@/utils/helpers/api-request";
import { logError } from "@/utils/helpers/loggers";
import { forgetUser } from "@/utils/helpers/local-storage";

export default function useLogout() {
  const { setUser } = useUser();
  const { language } = useLanguage();

  const logout = async () => {
    try {
      setUser(null);
      forgetUser();
      await apiRequest({ method: "GET", url: "auth/logout", credentials: "include", language });
    } catch (error) {
      logError("logout", error);
      throw error;
    }
  };

  return logout;
}
