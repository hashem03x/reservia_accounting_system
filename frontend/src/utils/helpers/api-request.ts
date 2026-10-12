import { ApiRequestOptions } from "@/types/api";
import { logError } from "@/utils/helpers/loggers";
import translate from "@/utils/helpers/translate";
import { downloadName, errorFromResponse, isErrorResponse, mediaType } from "@/utils/helpers/file-response";

export default async function apiRequest({
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
  responseType = "json",
  // The parsed JSON body of any endpoint - each caller knows its own response shape.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}: ApiRequestOptions): Promise<any> {
  try {
    // Serialize and append params to URL if any
    if (Object.keys(params).length) {
      const queryString = serializeParams(params);
      url += `?${queryString}`;
    }

    // Prepare body and headers
    let body: ApiRequestOptions["data"] = null;
    let finalHeaders = headers;

    if (data)
      if (data instanceof FormData) body = data;
      // Raw bytes (e.g. a backup file chunk) go as they are.
      else if (data instanceof Blob) {
        body = data;
        finalHeaders = { ...headers, "Content-Type": "application/octet-stream" };
      } else {
        body = JSON.stringify(data);
        finalHeaders = { ...headers, "Content-Type": "application/json" };
      }

    // Add Accept-Language header if language is provided
    if (language) {
      finalHeaders = { ...finalHeaders, "Accept-Language": language.slice(0, 2) };
    }

    // Prepare final options
    const finalOptions = { method, headers: finalHeaders, body, credentials, signal };

    // Send the request
    const response = await fetch(`${import.meta.env.VITE_API_URL}/${url}`, finalOptions);

    // A file request: an error - or a JSON body where a file was expected - is thrown, never saved.
    if (download || responseType === "blob") {
      if (isErrorResponse(response)) throw await errorFromResponse(response);
      const contentType = response.headers.get("Content-Type");
      // The server's name (with its real extension) first; the caller's name is the fallback.
      const name = downloadName(response.headers.get("Content-Disposition"), contentType, filename || "download");
      const blob = await response.blob();
      if (download) {
        downloadBlob(blob, name);
        return null;
      }
      return { blob, filename: name, contentType: mediaType(contentType) };
    }

    // Throw an error if the response isn't ok (JSON when the API sent JSON, else its text/status)
    if (!response.ok) {
      if (mediaType(response.headers.get("Content-Type")) === "application/json") throw await response.json();
      throw await errorFromResponse(response);
    }

    // If the response is 204 (No Content), return null
    if (response.status === 204) return null;

    // If it's ok, return the response as an object
    return await response.json();
  } catch (error) {
    logError("apiRequest", error);
    if (error instanceof TypeError && error.message === "Failed to fetch")
      throw new Error(translate(language, "Oops! Something went wrong while connecting.", "عذرًا! حدث خطأ أثناء الاتصال."));
    throw error;
  }
}

// =============================================================

function serializeParams(params: Record<string, string | number | boolean>): string {
  return new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)])).toString();
}

// =============================================================

function downloadBlob(blob: Blob, filename: string): void {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Released a moment later: revoking in the same tick can cancel the save in some browsers.
  setTimeout(() => window.URL.revokeObjectURL(url), 30_000);
}
