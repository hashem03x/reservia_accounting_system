import { useCallback, useEffect, useState } from "react";
import { FileButton } from "@mantine/core";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import { useLanguage } from "@/context/LanguageContext";
import { useHr } from "./hr-context";

// Documents on an HR record - expense receipts, attendance supporting documents (sick notes, signed
// timesheets) and site-visit documents. Listed, viewed and downloaded through the HR API, which
// checks on every request that the caller may see that employee's records (the employee, their
// line manager, MD/HR/Finance); files are never public links. Upload: the employee for their own
// record, or MD/HR. Backend: services/hr/hrService.js (listRecordFiles / fileForDownload).

type FileRow = { _id: string; originalName: string; contentType: string; size: number; createdAt: string; uploadedBy?: { name?: string } | null };
const ACCEPT = "application/pdf,image/png,image/jpeg,image/webp";
const kb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export default function RecordFiles({
  listUrl,
  uploadUrl,
  canUpload,
  title,
  emptyText,
  onUploaded,
  testId,
}: {
  /** e.g. "files/expense/<id>" or "attendance/<empId>/<month>/files" (relative to /hr). */
  listUrl: string;
  uploadUrl?: string;
  canUpload: boolean;
  title: string;
  emptyText: string;
  onUploaded?: () => void;
  testId?: string;
}) {
  const privateRequest = usePrivateRequest();
  const { translate, language } = useLanguage();
  const { toast } = useHr();
  const [files, setFiles] = useState<FileRow[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await privateRequest({ url: `hr/${listUrl}`, language });
      setFiles((res.data as FileRow[]) || []);
      setError("");
    } catch (e) {
      setError((e as Error).message || translate("Could not load the documents.", "تعذر تحميل المستندات."));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listUrl, language]);
  useEffect(() => {
    load();
  }, [load]);

  async function upload(list: File[]) {
    if (!list.length || !uploadUrl) return;
    setBusy(true);
    try {
      const form = new FormData();
      list.forEach((f) => form.append("files", f, f.name));
      await privateRequest({ url: `hr/${uploadUrl}`, method: "POST", data: form, language });
      toast(translate("Document uploaded", "تم رفع المستند"));
      await load();
      onUploaded?.();
    } catch (e) {
      toast((e as Error).message || translate("The upload failed.", "فشل الرفع."));
    } finally {
      setBusy(false);
    }
  }

  async function view(f: FileRow) {
    const tab = window.open("", "_blank");
    try {
      const res = (await privateRequest({ url: `hr/files/download/${f._id}`, params: { inline: 1 }, language, responseType: "blob" })) as { blob: Blob };
      const url = URL.createObjectURL(res.blob);
      if (tab) tab.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      tab?.close();
      toast((e as Error).message || translate("Could not open the document.", "تعذر فتح المستند."));
    }
  }
  const download = (f: FileRow) => privateRequest({ url: `hr/files/download/${f._id}`, language, download: true, filename: f.originalName }).catch((e) => toast((e as Error).message));

  return (
    <div className="sect" data-testid={testId}>
      <h4>{title}</h4>
      {error && <div className="warnline">{error}</div>}
      {files && !files.length && !error && <div className="sub">{emptyText}</div>}
      {files?.map((f) => (
        <div className="rowline" key={f._id} data-testid="hr-file-row">
          <span className="min-w-0">
            <b className="break-all">{f.originalName}</b>{" "}
            <span className="sub">
              {kb(f.size)} · {String(f.createdAt).slice(0, 10)}
              {f.uploadedBy?.name ? ` · ${f.uploadedBy.name}` : ""}
            </span>
          </span>
          <span className="row2">
            <button className="btn sm" onClick={() => view(f)} data-testid="hr-file-view">
              {translate("View", "عرض")}
            </button>
            <button className="btn sm" onClick={() => download(f)} data-testid="hr-file-download">
              {translate("Download", "تنزيل")}
            </button>
          </span>
        </div>
      ))}
      {canUpload && uploadUrl && (
        <div className="row2">
          <FileButton onChange={upload} accept={ACCEPT} multiple>
            {(props) => (
              <button {...props} className="btn sm" disabled={busy} data-testid="hr-file-upload">
                {busy ? translate("Uploading...", "جار الرفع...") : translate("Upload PDF or photo", "رفع ملف PDF أو صورة")}
              </button>
            )}
          </FileButton>
          <span className="sub">{translate("PDF, JPG, PNG or WebP. Stored privately; only you, your line manager and HR can open it.", "PDF أو JPG أو PNG أو WebP. يُحفظ بشكل خاص؛ لا يفتحه إلا أنت ومديرك المباشر والموارد البشرية.")}</span>
        </div>
      )}
    </div>
  );
}
