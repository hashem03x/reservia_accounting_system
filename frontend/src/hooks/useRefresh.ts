import { useUser } from "@/context/UserContext";
import { useLanguage } from "@/context/LanguageContext";
import { logError } from "@/utils/helpers/loggers";
import apiRequest from "@/utils/helpers/api-request";
import extractUserInfo from "@/utils/helpers/extract-user-info";

export default function useRefresh() {
  const { setUser } = useUser();
  const { language } = useLanguage();

  const refreshAccessToken = async () => {
    try {
      const data = await apiRequest({ url: "auth/refresh-token", credentials: "include", language });
      setUser(extractUserInfo(data));
      return data.token;
    } catch (error) {
      logError("refreshAccessToken", error);
      throw error;
    }
  };

  return refreshAccessToken;
}
