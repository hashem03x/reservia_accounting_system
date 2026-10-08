import { useRef, useState } from "react";
import { Button, Loader } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import { formatDateAndTime } from "@/utils/helpers/date-formaters";
import { outlineIcons, solidIcons } from "@/components/icons";
import ErrorAlert from "@/components/ui/error-alert";
import { OrderDocument } from "@/types/orders";

const pdfMimeType = "application/pdf";

/**
 * PDF documents of an existing Sales Order or Purchase Order - add, open and remove them after
 * the order was created. Uploads go through the same backend PDF pipeline (PDF only, 10 MB) as
 * Customer/Vendor documents. `canManage` (the order's update permission) controls add/remove;
 * everyone who can see the order can open its documents.
 */
export default function OrderDocumentsSection({
  apiBase,
  orderId,
  documents,
  onChange,
  canManage,
}: {
  // "sale-orders" or "purchaseOrder" - the order API the documents endpoints live under.
  apiBase: "sale-orders" | "purchaseOrder";
  orderId: string;
  documents: OrderDocument[] | undefined;
  onChange: (documents: OrderDocument[]) => void;
  canManage: boolean;
}) {
  const { language, translate } = useLanguage();
  const privateRequest = usePrivateRequest();
  const inputRef = useRef<HTMLInputElement>(null);

  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const list = Array.isArray(documents) ? documents : [];
  const busy = uploading || !!deletingId;

  const errorText = (err: unknown, fallback: string) =>
    (err as Error)?.message || (err as { errors?: { msg: string }[] })?.errors?.[0]?.msg || fallback;

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file after a failed upload
    if (!file || busy) return;

    if (file.type !== pdfMimeType || !file.name.toLowerCase().endsWith(".pdf")) {
      setError(translate("Only PDF files are allowed.", "يُسمح فقط بملفات PDF."));
      return;
    }

    setError("");
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("document", file);
      const res = await privateRequest({ url: `${apiBase}/${orderId}/documents`, method: "POST", data: formData, language });
      onChange(Array.isArray(res?.data?.documents) ? res.data.documents : list);
    } catch (err) {
      setError(errorText(err, translate("Failed to upload document.", "فشل تحميل المستند.")));
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(document: OrderDocument) {
    if (busy) return;
    if (!confirm(translate(`Remove "${document.filename || "document"}"?`, `حذف "${document.filename || "المستند"}"؟`))) return;
    setError("");
    setDeletingId(document._id);
    try {
      const res = await privateRequest({ url: `${apiBase}/${orderId}/documents/${document._id}`, method: "DELETE", language });
      onChange(Array.isArray(res?.data?.documents) ? res.data.documents : list.filter((d) => d._id !== document._id));
    } catch (err) {
      setError(errorText(err, translate("Failed to delete document.", "فشل حذف المستند.")));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4>{translate("Documents", "المستندات")}</h4>
        {canManage && (
          <>
            <Button
              size="xs"
              variant="light"
              leftSection={<solidIcons.Plus />}
              loading={uploading}
              disabled={!!deletingId}
              onClick={() => inputRef.current?.click()}
            >
              {translate("Add PDF", "إضافة PDF")}
            </Button>
            <input ref={inputRef} type="file" accept=".pdf,application/pdf" hidden onChange={handleFileSelected} />
          </>
        )}
      </div>

      {error && <ErrorAlert error={error} radius="sm" />}

      {list.length === 0 ? (
        <p className="text-xs text-gray-500 sm:text-sm">{translate("No documents attached yet.", "لا توجد مستندات مرفقة بعد.")}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {list.map((document) => (
            <div key={document._id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 p-2 px-3">
              <div className="flex min-w-0 items-center gap-2">
                <outlineIcons.Document className="shrink-0 text-gray-500" size={18} />
                <div className="flex min-w-0 flex-col">
                  <p className="truncate text-sm font-medium" title={document.filename}>
                    {document.filename || translate("Document", "مستند")}
                  </p>
                  <p className="text-xs text-gray-500">
                    PDF{document.uploadedAt ? ` · ${formatDateAndTime(document.uploadedAt, language)}` : ""}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {deletingId === document._id ? (
                  <Loader size="xs" />
                ) : (
                  <>
                    <a href={document.url} target="_blank" rel="noopener noreferrer" title={translate("Open", "فتح")}>
                      <solidIcons.Eye className="text-gray-600 hover:text-blue-600" size={16} />
                    </a>
                    {canManage && (
                      <button type="button" onClick={() => handleDelete(document)} disabled={busy} title={translate("Delete", "حذف")}>
                        <outlineIcons.Trash className="text-red-500 hover:text-red-700" size={16} />
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
