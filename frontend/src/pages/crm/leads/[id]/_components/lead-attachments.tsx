import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Progress } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import { useUser } from "@/context/UserContext";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import useRefresh from "@/hooks/useRefresh";
import handleRequest from "@/utils/helpers/handle-request";
import { notifySuccess } from "@/utils/helpers/notifiers";
import { formatDateAndTime } from "@/utils/helpers/date-formaters";
import { outlineIcons, solidIcons } from "@/components/icons";
import ErrorAlert from "@/components/ui/error-alert";
import Modal from "@/components/ui/modal";
import { checkPdf, DEFAULT_LIMITS, formatBytes } from "@/components/global/attachments/use-attachment-upload";
import PdfPreviewModal from "@/components/global/attachments/pdf-preview-modal";
import { Attachment, AttachmentLimits } from "@/types/attachment";

// A lead's attached documents (acceptance report section 7 - file upload, e.g. an electricity
// bill). Deliberately NOT the shared AttachmentsPanel (components/global/attachments/) - that
// component's upload URL is hardcoded to the ERP's own `attachments/:ownerKey/:ownerId` route,
// which is gated by the ERP's resource:action permission system
// (controller/attachmentController.js#userCan). A CRM sales/technical user may hold no ERP
// permissions at all, so lead attachments are served by a separate, CRM-role-gated route
// (routes/crm/leadAttachmentRoute.js) instead - this component targets that route, reusing every
// PURE piece of the shared implementation (PDF validation, the preview modal, byte formatting)
// rather than duplicating them.

type Pending = { key: string; file: File; progress: number; error?: string };

function send(url: string, file: File, token: string, language: string, onProgress?: (fraction: number) => void) {
  return new Promise<{ status: number; body: { message?: string; data?: Attachment[] } | null }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("Accept-Language", language.slice(0, 2));
    xhr.upload.onprogress = e => {
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

export default function LeadAttachments({ leadId, canEdit }: { leadId: string; canEdit: boolean }) {
  const { language, translate } = useLanguage();
  const { user } = useUser();
  const privateRequest = usePrivateRequest();
  const refresh = useRefresh();
  const inputRef = useRef<HTMLInputElement>(null);

  const [rows, setRows] = useState<Attachment[]>([]);
  const [limits, setLimits] = useState<AttachmentLimits>(DEFAULT_LIMITS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const [preview, setPreview] = useState<Attachment | null>(null);
  const [toDelete, setToDelete] = useState<Attachment | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [downloading, setDownloading] = useState<string | null>(null);

  const load = useCallback(
    () =>
      handleRequest(language, setLoading, setError, async () => {
        const res = await privateRequest({ url: `crm/leads/${leadId}/attachments`, language });
        setRows(res.data || []);
        if (res.limits) setLimits(res.limits);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [leadId, language],
  );
  useEffect(() => {
    load();
  }, [load]);

  async function uploadOne(file: File, onProgress?: (fraction: number) => void): Promise<Attachment[]> {
    if (!user) throw new Error(translate("Sign in again to upload.", "سجّل الدخول مرة أخرى للرفع."));
    const url = `${import.meta.env.VITE_API_URL}/crm/leads/${leadId}/attachments`;
    let result = await send(url, file, user.accessToken, language, onProgress);
    if (result.status === 401) {
      const token = await refresh();
      result = await send(url, file, token, language, onProgress);
    }
    if (result.status < 200 || result.status >= 300) throw new Error(result.body?.message || translate(`The upload failed (${result.status}).`, `فشل الرفع (${result.status}).`));
    return result.body?.data || [];
  }

  async function addFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const chosen = Array.from(e.target.files || []);
    e.target.value = "";
    const room = Math.max(0, limits.maxFiles - rows.length);
    const queue: Pending[] = chosen.map((file, i) => {
      const problem =
        checkPdf(file, limits, translate, { allowImages: true }) ||
        (i >= room ? translate(`At most ${limits.maxFiles} files can be attached.`, `يمكن إرفاق ${limits.maxFiles} ملفات كحد أقصى.`) : undefined);
      return { key: `${Date.now()}-${i}-${file.name}`, file, progress: 0, error: problem || undefined };
    });
    setPending(p => [...p, ...queue]);
    let uploaded = 0;
    for (const item of queue) {
      if (item.error) continue;
      try {
        const list = await uploadOne(item.file, fraction => setPending(p => p.map(x => (x.key === item.key ? { ...x, progress: fraction } : x))));
        setRows(list);
        uploaded += 1;
        setPending(p => p.filter(x => x.key !== item.key));
      } catch (err) {
        setPending(p => p.map(x => (x.key === item.key ? { ...x, error: (err as Error).message } : x)));
      }
    }
    if (uploaded) notifySuccess({ language, message: translate(`${uploaded} file(s) attached.`, `تم إرفاق ${uploaded} ملف.`) });
  }

  async function download(a: Attachment) {
    setDownloading(a._id);
    setError("");
    try {
      await privateRequest({ url: `crm/attachments/${a._id}/download`, download: true, filename: a.originalName, language });
    } catch (err) {
      setError((err as Error)?.message || translate("The download failed.", "فشل التنزيل."));
    } finally {
      setDownloading(null);
    }
  }

  async function remove() {
    if (!toDelete) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await privateRequest({ url: `crm/attachments/${toDelete._id}`, method: "DELETE", language });
      setRows(r => r.filter(x => x._id !== toDelete._id));
      setToDelete(null);
      notifySuccess({ language, message: translate("Attachment removed.", "تم حذف المرفق.") });
    } catch (err) {
      setDeleteError((err as Error)?.message || translate("The attachment could not be removed.", "تعذر حذف المرفق."));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-gray-100 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4>{translate("Attachments", "المرفقات")}</h4>
          <p className="text-xs text-gray-500">
            {translate(
              `PDF or image documents for this lead, e.g. an electricity bill (up to ${limits.maxFiles}, ${formatBytes(limits.maxBytes)} each).`,
              `مستندات PDF أو صور الخاصة بهذا العميل، مثل فاتورة الكهرباء (حتى ${limits.maxFiles} ملف، ${formatBytes(limits.maxBytes)} لكل ملف).`,
            )}
          </p>
        </div>
        <Button size="xs" variant="light" leftSection={<solidIcons.Plus size={12} />} onClick={() => inputRef.current?.click()} disabled={rows.length >= limits.maxFiles}>
          {translate("Attach files", "إرفاق ملفات")}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
          multiple
          hidden
          onChange={addFiles}
        />
      </div>

      {error && <ErrorAlert error={error} />}

      {pending.length > 0 && (
        <ul className="flex flex-col gap-2">
          {pending.map(p => (
            <li key={p.key} className="rounded-md border border-gray-100 px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate" title={p.file.name} dir="auto">
                  {p.file.name} <span className="text-xs text-gray-500">{formatBytes(p.file.size)}</span>
                </span>
                {p.error && (
                  <button type="button" onClick={() => setPending(x => x.filter(y => y.key !== p.key))} title={translate("Dismiss", "إغلاق")}>
                    <solidIcons.XMark size={14} />
                  </button>
                )}
              </div>
              {p.error ? <p className="mt-1 text-xs text-red-600">{p.error}</p> : <Progress value={Math.round(p.progress * 100)} size="sm" mt={6} animated={p.progress < 1} />}
            </li>
          ))}
        </ul>
      )}

      {loading && !rows.length ? null : rows.length === 0 ? (
        <p className="text-sm text-gray-500">{translate("No attachments yet.", "لا توجد مرفقات بعد.")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-gray-100 rounded-md border border-gray-100">
          {rows.map(a => (
            <li key={a._id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <button type="button" className="flex min-w-0 items-center gap-2 text-start" onClick={() => setPreview(a)} title={translate("Preview", "معاينة")}>
                <outlineIcons.Document className="shrink-0 text-red-500" size={20} />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium hover:underline" dir="auto">
                    {a.originalName}
                  </span>
                  <span className="text-xs text-gray-500">
                    {formatBytes(a.size)} · {formatDateAndTime(a.createdAt, language)}
                    {a.uploadedBy?.name ? ` · ${a.uploadedBy.name}` : ""}
                  </span>
                </span>
              </button>
              <span className="flex items-center gap-1">
                <Button size="compact-xs" variant="subtle" onClick={() => setPreview(a)} leftSection={<solidIcons.Eye size={12} />}>
                  {translate("Preview", "معاينة")}
                </Button>
                <Button size="compact-xs" variant="subtle" onClick={() => download(a)} loading={downloading === a._id} leftSection={<solidIcons.Download size={12} />}>
                  {translate("Download", "تحميل")}
                </Button>
                {canEdit && (
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    color="red"
                    onClick={() => {
                      setDeleteError("");
                      setToDelete(a);
                    }}
                    leftSection={<outlineIcons.Trash size={12} />}
                  >
                    {translate("Remove", "حذف")}
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      <PdfPreviewModal url={preview ? `crm/attachments/${preview._id}/download` : null} title={preview?.originalName || ""} onClose={() => setPreview(null)} />

      <Modal opened={!!toDelete} onClose={() => !deleting && setToDelete(null)} title={translate("Remove attachment", "حذف المرفق")}>
        <div className="flex flex-col gap-4">
          <p className="text-sm">{translate(`Remove "${toDelete?.originalName}"? This cannot be undone.`, `حذف "${toDelete?.originalName}"؟ لا يمكن التراجع عن هذا الإجراء.`)}</p>
          {deleteError && <ErrorAlert error={deleteError} />}
          <div className="flex justify-end gap-2">
            <Button variant="default" onClick={() => setToDelete(null)} disabled={deleting}>
              {translate("Cancel", "إلغاء")}
            </Button>
            <Button color="red" onClick={remove} loading={deleting}>
              {translate("Remove", "حذف")}
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
