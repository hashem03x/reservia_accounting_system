import { ApiRequestOptions } from "@/types/api";
import { logError } from "@/utils/helpers/loggers";
import apiRequest from "@/utils/helpers/api-request";
import { useUser } from "@/context/UserContext";
import useLogout from "@/hooks/useLogout";
import useRefresh from "@/hooks/useRefresh";

const accessTokenError = "jwt expired";
const refreshTokenError = "Invalid refresh token.";

export default function usePrivateRequest() {
  const { user } = useUser();
  const logout = useLogout();
  const refreshAccessToken = useRefresh();

  async function privateRequest({
    url,
    method = "GET",
    headers = {},
    params = {},
    data = null,
    credentials = "same-origin",
    language = "en-US",
    signal,
    download,
    filename,
  }: ApiRequestOptions) {
    try {
      if (!user) throw new Error("No user logged in.");
      // Add the access token to the request headers if it doesn't exist
      let newHeaders = headers;
      if (!new Headers(headers).has("authorization")) newHeaders = { authorization: `Bearer ${user.accessToken}`, ...headers };
      // Send the request with the access token
      return await apiRequest({
        url,
        method,
        headers: newHeaders,
        params,
        data,
        credentials,
        signal,
        language,
        download,
        filename,
      });
    } catch (error) {
      if ((error as Error).message === accessTokenError) {
        try {
          // Refresh the access token
          const newAccessToken = await refreshAccessToken();
          const newHeaders = { authorization: `Bearer ${newAccessToken}`, ...headers };
          // Send a new request with the new access token
          return await privateRequest({
            url,
            method,
            headers: newHeaders,
            data,
            credentials,
            signal,
            language,
            download,
            filename,
          });
        } catch (error) {
          if ((error as Error).message === refreshTokenError) logout();
          throw error;
        }
      } else {
        logError("privateRequest", error);
        throw error;
      }
    }
  }

  return privateRequest;
}
