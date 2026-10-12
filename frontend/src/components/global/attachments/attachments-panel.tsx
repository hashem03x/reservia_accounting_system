import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Progress } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import handleRequest from "@/utils/helpers/handle-request";
import { notifySuccess } from "@/utils/helpers/notifiers";
import { formatDateAndTime } from "@/utils/helpers/date-formaters";
import { outlineIcons, solidIcons } from "@/components/icons";
import ErrorAlert from "@/components/ui/error-alert";
import Modal from "@/components/ui/modal";
import { Attachment, AttachmentLimits, AttachmentOwnerKey } from "@/types/attachment";
import useAttachmentUpload, { checkPdf, DEFAULT_LIMITS, formatBytes } from "./use-attachment-upload";
import PdfPreviewModal from "./pdf-preview-modal";

type Pending = { key: string; file: File; progress: number; error?: string };

/**
 * The PDF attachments of a purchase order, sales order or journal entry: list, preview, download,
 * attach more (with progress) and remove (confirmed). Attaching never changes the record or its
 * accounting. `canEdit` = the user's update permission on the record (the server checks it too).
 */
export default function AttachmentsPanel({
  ownerKey,
  ownerId,
  canEdit,
}: {
  ownerKey: AttachmentOwnerKey;
  ownerId: string;
  canEdit: boolean;
}) {
  const { language, translate } = useLanguage();
  const privateRequest = usePrivateRequest();
  const upload = useAttachmentUpload();
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
        const res = await privateRequest({ url: `attachments/${ownerKey}/${ownerId}`, language });
        setRows(res.data || []);
        if (res.limits) setLimits(res.limits);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ownerKey, ownerId, language],
  );
  useEffect(() => {
    load();
  }, [load]);

  async function addFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const chosen = Array.from(e.target.files || []);
    e.target.value = "";
    const room = Math.max(0, limits.maxFiles - rows.length);
    const queue: Pending[] = chosen.map((file, i) => {
      const problem =
        checkPdf(file, limits, translate) ||
        (i >= room
          ? translate(`At most ${limits.maxFiles} files can be attached.`, `يمكن إرفاق ${limits.maxFiles} ملفات كحد أقصى.`)
          : undefined);
      return { key: `${Date.now()}-${i}-${file.name}`, file, progress: 0, error: problem || undefined };
    });
    setPending((p) => [...p, ...queue]);
    let uploaded = 0;
    for (const item of queue) {
      if (item.error) continue;
      try {
        // eslint-disable-next-line no-await-in-loop
        const list = await upload(ownerKey, ownerId, item.file, (fraction) =>
          setPending((p) => p.map((x) => (x.key === item.key ? { ...x, progress: fraction } : x))),
        );
        setRows(list);
        uploaded += 1;
        setPending((p) => p.filter((x) => x.key !== item.key));
      } catch (err) {
        setPending((p) => p.map((x) => (x.key === item.key ? { ...x, error: (err as Error).message } : x)));
      }
    }
    if (uploaded)
      notifySuccess({
        language,
        message: translate(`${uploaded} file(s) attached.`, `تم إرفاق ${uploaded} ملف.`),
      });
  }

  async function download(a: Attachment) {
    setDownloading(a._id);
    setError("");
    try {
      await privateRequest({ url: `attachments/${a._id}/download`, download: true, filename: a.originalName, language });
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
      await privateRequest({ url: `attachments/${toDelete._id}`, method: "DELETE", language });
      setRows((r) => r.filter((x) => x._id !== toDelete._id));
      setToDelete(null);
      notifySuccess({ language, message: translate("Attachment removed.", "تم حذف المرفق.") });
    } catch (err) {
      setDeleteError((err as Error)?.message || translate("The attachment could not be removed.", "تعذر حذف المرفق."));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4>{translate("Attachments", "المرفقات")}</h4>
          <p className="text-xs text-gray-500">
            {translate(
              `PDF documents of this record (up to ${limits.maxFiles}, ${formatBytes(limits.maxBytes)} each).`,
              `مستندات PDF الخاصة بهذا السجل (حتى ${limits.maxFiles} ملف، ${formatBytes(limits.maxBytes)} لكل ملف).`,
            )}
          </p>
        </div>
        {canEdit && (
          <>
            <Button
              size="xs"
              variant="light"
              leftSection={<solidIcons.Plus size={12} />}
              onClick={() => inputRef.current?.click()}
              disabled={rows.length >= limits.maxFiles}
            >
              {translate("Attach PDFs", "إرفاق ملفات PDF")}
            </Button>
            <input ref={inputRef} type="file" accept=".pdf,application/pdf" multiple hidden onChange={addFiles} />
          </>
        )}
      </div>

      {error && <ErrorAlert error={error} />}

      {pending.length > 0 && (
        <ul className="flex flex-col gap-2">
          {pending.map((p) => (
            <li key={p.key} className="rounded-md border border-gray-100 px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate" title={p.file.name} dir="auto">
                  {p.file.name} <span className="text-xs text-gray-500">{formatBytes(p.file.size)}</span>
                </span>
                {p.error && (
                  <button
                    type="button"
                    onClick={() => setPending((x) => x.filter((y) => y.key !== p.key))}
                    title={translate("Dismiss", "إغلاق")}
                  >
                    <solidIcons.XMark size={14} />
                  </button>
                )}
              </div>
              {p.error ? (
                <p className="mt-1 text-xs text-red-600">{p.error}</p>
              ) : (
                <Progress value={Math.round(p.progress * 100)} size="sm" mt={6} animated={p.progress < 1} />
              )}
            </li>
          ))}
        </ul>
      )}

      {loading && !rows.length ? null : rows.length === 0 ? (
        <p className="text-sm text-gray-500">{translate("No attachments yet.", "لا توجد مرفقات بعد.")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-gray-100 rounded-md border border-gray-100">
          {rows.map((a) => (
            <li key={a._id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <button
                type="button"
                className="flex min-w-0 items-center gap-2 text-start"
                onClick={() => setPreview(a)}
                title={translate("Preview", "معاينة")}
              >
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
                <Button
                  size="compact-xs"
                  variant="subtle"
                  onClick={() => setPreview(a)}
                  leftSection={<solidIcons.Eye size={12} />}
                >
                  {translate("Preview", "معاينة")}
                </Button>
                <Button
                  size="compact-xs"
                  variant="subtle"
                  onClick={() => download(a)}
                  loading={downloading === a._id}
                  leftSection={<solidIcons.Download size={12} />}
                >
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

      <PdfPreviewModal
        url={preview ? `attachments/${preview._id}/download` : null}
        title={preview?.originalName || ""}
        onClose={() => setPreview(null)}
      />

      <Modal
        opened={!!toDelete}
        onClose={() => !deleting && setToDelete(null)}
        title={translate("Remove attachment", "حذف المرفق")}
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm">
            {translate(
              `Remove "${toDelete?.originalName}"? The file is deleted; the record and its accounting are not changed.`,
              `حذف "${toDelete?.originalName}"؟ سيتم حذف الملف دون أي تغيير على السجل أو قيوده المحاسبية.`,
            )}
          </p>
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
