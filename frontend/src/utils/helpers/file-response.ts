// Turning an API file response into a named file - shared by every download in the app
// (api-request.ts). No imports, so it is unit-tested directly with Node (file-response.test.ts).
//
// A file is only ever saved from a successful response that is NOT JSON: an error (or an endpoint
// answering 200 with a JSON error) is read and thrown, never saved as "invoice.pdf". The name comes
// from the server's Content-Disposition (RFC 5987 UTF-8 name first, so Arabic names survive), and
// always ends with the extension of its content type when it has none.

const EXTENSIONS: Record<string, string> = {
  "application/pdf": ".pdf",
  "application/gzip": ".gz",
  "application/zip": ".zip",
  "application/json": ".json",
  "text/csv": ".csv",
  "text/plain": ".txt",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.ms-excel": ".xls",
};

/** The media type without parameters ("application/pdf; charset=x" -> "application/pdf"). */
export function mediaType(contentType: string | null | undefined): string {
  return (contentType || "").split(";")[0].trim().toLowerCase();
}

/** The file name a Content-Disposition header gives (UTF-8 `filename*` preferred). */
export function filenameFromDisposition(header: string | null | undefined): string | undefined {
  if (!header) return undefined;
  const rfc5987 = header.match(/filename\*\s*=\s*(?:UTF-8|utf-8)''([^;\r\n]+)/);
  if (rfc5987?.[1]) {
    try {
      return decodeURIComponent(rfc5987[1].trim());
    } catch {
      // fall through to the plain name
    }
  }
  const quoted = header.match(/filename\s*=\s*"((?:[^"\\]|\\.)*)"/i);
  if (quoted?.[1]) return quoted[1].replace(/\\(.)/g, "$1");
  const bare = header.match(/filename\s*=\s*([^;\s]+)/i);
  return bare?.[1];
}

/** `name` with the extension of `contentType` added when it has no extension of its own. */
export function ensureExtension(name: string, contentType: string | null | undefined): string {
  const wanted = EXTENSIONS[mediaType(contentType)];
  if (!wanted || /\.[a-z][a-z0-9]{0,9}$/i.test(name)) return name;
  return `${name}${wanted}`;
}

/** The name to save a response under: the server's, else the caller's fallback - with an extension. */
export function downloadName(
  header: string | null | undefined,
  contentType: string | null | undefined,
  fallback = "download",
): string {
  const name = (filenameFromDisposition(header) || fallback || "download").replace(/[\\/]/g, "_").trim() || "download";
  return ensureExtension(name, contentType);
}

/** True when a response is (or carries) an error rather than the requested file. */
export function isErrorResponse(response: { ok: boolean; headers: { get(name: string): string | null } }): boolean {
  if (!response.ok) return true;
  const type = mediaType(response.headers.get("content-type"));
  return type === "application/json" || type.endsWith("+json");
}

/** The message of an error response - JSON `message`/`error`, else its text, else the status. */
export async function errorFromResponse(response: {
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}): Promise<Error & { status?: number; message: string }> {
  let message = "";
  try {
    const text = await response.text();
    try {
      const body = JSON.parse(text);
      message = body?.message || body?.error?.message || (typeof body?.error === "string" ? body.error : "");
    } catch {
      message = mediaType(response.headers.get("content-type")).startsWith("text/") ? text.slice(0, 300) : "";
    }
  } catch {
    message = "";
  }
  const error = Object.assign(new Error(message || `The request failed (${response.status}).`), { status: response.status });
  return error;
}
