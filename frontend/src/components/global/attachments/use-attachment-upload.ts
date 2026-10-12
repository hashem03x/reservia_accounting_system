import { useUser } from "@/context/UserContext";
import { useLanguage } from "@/context/LanguageContext";
import useRefresh from "@/hooks/useRefresh";
import { Attachment, AttachmentLimits, AttachmentOwnerKey } from "@/types/attachment";

// Uploading attachments with progress. XMLHttpRequest (not fetch) because only it reports upload
// progress. One file per request, so each stays under the hosting request-size limit (Vercel
// accepts ~4.5 MB per request). A request refused for an expired session is retried once with a
// refreshed token, as every other request in the app is (usePrivateRequest).

export const DEFAULT_LIMITS: AttachmentLimits = { maxBytes: 10 * 1024 * 1024, maxFiles: 20 };

export const formatBytes = (bytes: number) =>
  bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** Why a chosen file cannot be attached (checked again, by content, on the server) - or null. */
export function checkPdf(
  file: File,
  limits: AttachmentLimits,
  translate: (en: string, ar: string) => string,
): string | null {
  if (!/\.pdf$/i.test(file.name) || (file.type && !["application/pdf", "application/x-pdf"].includes(file.type)))
    return translate(`"${file.name}" is not a PDF file.`, `"${file.name}" ليس ملف PDF.`);
  if (file.size === 0) return translate(`"${file.name}" is empty.`, `"${file.name}" فارغ.`);
  if (file.size > limits.maxBytes)
    return translate(
      `"${file.name}" is larger than the ${formatBytes(limits.maxBytes)} limit.`,
      `"${file.name}" أكبر من الحد المسموح ${formatBytes(limits.maxBytes)}.`,
    );
  return null;
}

type Sent = { status: number; body: { message?: string; data?: Attachment[] } | null };

function send(url: string, file: File, token: string, language: string, onProgress?: (fraction: number) => void) {
  return new Promise<Sent>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("Accept-Language", language.slice(0, 2));
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      let body = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = null;
      }
      resolve({ status: xhr.status, body });
    };
    xhr.onerror = () => reject(new Error("network"));
    const form = new FormData();
    form.append("files", file, file.name);
    xhr.send(form);
  });
}

export default function useAttachmentUpload() {
  const { user } = useUser();
  const { language, translate } = useLanguage();
  const refresh = useRefresh();

  /** Uploads one PDF; resolves with the record's attachments, rejects with a readable message. */
  return async function upload(
    ownerKey: AttachmentOwnerKey,
    ownerId: string,
    file: File,
    onProgress?: (fraction: number) => void,
  ): Promise<Attachment[]> {
    if (!user) throw new Error(translate("Sign in again to upload.", "سجّل الدخول مرة أخرى للرفع."));
    const url = `${import.meta.env.VITE_API_URL}/attachments/${ownerKey}/${ownerId}`;
    let result: Sent;
    try {
      result = await send(url, file, user.accessToken, language, onProgress);
      if (result.status === 401) {
        const token = await refresh();
        result = await send(url, file, token, language, onProgress);
      }
    } catch {
      throw new Error(
        translate("The upload failed - check the connection and try again.", "فشل الرفع - تحقق من الاتصال وحاول مرة أخرى."),
      );
    }
    if (result.status < 200 || result.status >= 300)
      throw new Error(
        result.body?.message || translate(`The upload failed (${result.status}).`, `فشل الرفع (${result.status}).`),
      );
    return result.body?.data || [];
  };
}

/**
 * Uploads the PDFs chosen on a create form once the record exists. Resolves with the files that
 * failed (with why) - the record itself is saved either way; failed files can be attached again
 * from its page.
 */
export async function uploadPendingAttachments(
  upload: ReturnType<typeof useAttachmentUpload>,
  ownerKey: AttachmentOwnerKey,
  ownerId: string,
  files: File[],
): Promise<{ file: File; error: string }[]> {
  const failed: { file: File; error: string }[] = [];
  for (const file of files) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await upload(ownerKey, ownerId, file);
    } catch (err) {
      failed.push({ file, error: (err as Error).message });
    }
  }
  return failed;
}
