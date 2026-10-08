import { ApiRequestOptions } from "@/types/api";
import { logError } from "@/utils/helpers/loggers";
import translate from "@/utils/helpers/translate";

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
      else {
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

    // Throw an error if the response isn't ok
    if (!response.ok) throw await response.json();

    // If it's a download request, download the file and return null
    if (download) {
      const contentDisposition = response.headers.get("Content-Disposition");
      const serverFilename = parseFilenameFromContentDisposition(contentDisposition);
      const finalFilename = filename || serverFilename || "download";

      const blob = await response.blob();
      downloadBlob(blob, finalFilename);
      return null;
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

/** Prefer server filename from Content-Disposition (must be listed in CORS exposedHeaders). */
function parseFilenameFromContentDisposition(header: string | null): string | undefined {
  if (!header) return undefined;
  const rfc5987 = header.match(/filename\*=UTF-8''([^;\r\n]+)/i);
  if (rfc5987?.[1]) {
    try {
      return decodeURIComponent(rfc5987[1]);
    } catch {
      return rfc5987[1];
    }
  }
  const nameInQuotes = header.match(/filename="([^"]+)"/i);
  if (nameInQuotes?.[1]) return nameInQuotes[1];
  const nameUnquoted = header.match(/filename=([^;\s]+)/i);
  return nameUnquoted?.[1]?.replace(/^["']|["']$/g, "");
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
  window.URL.revokeObjectURL(url);
}
