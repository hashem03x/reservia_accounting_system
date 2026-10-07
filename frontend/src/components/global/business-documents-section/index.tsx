import { useRef, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import { BusinessDocument, DocumentType } from "@/types/document";
import { documentTypesArray, getDocumentTypeLabel } from "@/utils/constants/document-types";
import { Button, Loader } from "@mantine/core";
import { outlineIcons, solidIcons } from "@/components/icons";
import ErrorAlert from "@/components/ui/error-alert";

const pdfMimeType = "application/pdf";
const invalidPdfMessage = { en: "Only PDF files are allowed.", ar: "يُسمح فقط بملفات PDF." };

/**
 * Six fixed, optional PDF upload slots shared by the Customer and Vendor forms (identical
 * `documents: BusinessDocument[]` shape on both entities - see
 * backend/server/models/shared/businessPartnerSchemas.js). Each slot uploads/replaces/deletes
 * immediately against its own endpoint (not staged with the rest of the form) because the
 * backend requires an existing customer/vendor id to attach a document to - see
 * docs/entities/customers.md.
 */
export default function BusinessDocumentsSection({
  entityType,
  entityId,
  documents,
  onChange,
}: {
  entityType: "customers" | "vendors";
  entityId?: string;
  documents: BusinessDocument[];
  onChange: (documents: BusinessDocument[]) => void;
}) {
  const { translate } = useLanguage();

  if (!entityId) {
    return (
      <section className="flex flex-col gap-2">
        <h4>{translate("Documents (Optional)", "المستندات (اختياري)")}</h4>
        <p className="text-xs text-gray-500 sm:text-sm">
          {translate(
            "Save this record first to attach PDF documents.",
            "يرجى الحفظ أولاً لإضافة مستندات PDF.",
          )}
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-2">
      <h4>{translate("Documents (Optional)", "المستندات (اختياري)")}</h4>
      <div className="flex flex-col gap-2">
        {documentTypesArray.map((docType) => (
          <DocumentSlot
            key={docType.value}
            entityType={entityType}
            entityId={entityId}
            documentType={docType.value}
            document={documents.find((doc) => doc.documentType === docType.value) || null}
            onChange={(updatedDocuments) => onChange(updatedDocuments)}
          />
        ))}
      </div>
    </section>
  );
}

function DocumentSlot({
  entityType,
  entityId,
  documentType,
  document,
  onChange,
}: {
  entityType: "customers" | "vendors";
  entityId: string;
  documentType: DocumentType;
  document: BusinessDocument | null;
  onChange: (documents: BusinessDocument[]) => void;
}) {
  const { language, translate } = useLanguage();
  const privateRequest = usePrivateRequest();
  const inputRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // Allow re-selecting the same file later (e.g. after a failed upload).
    if (!file) return;

    if (file.type !== pdfMimeType || !file.name.toLowerCase().endsWith(".pdf")) {
      setError(translate(invalidPdfMessage.en, invalidPdfMessage.ar));
      return;
    }

    setError("");
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append("documentType", documentType);
      formData.append("document", file);

      const res = await privateRequest({
        url: `${entityType}/${entityId}/documents`,
        method: "POST",
        data: formData,
        language,
      });

      onChange(res.data.documents);
    } catch (err) {
      setError((err as Error)?.message || translate("Failed to upload document.", "فشل تحميل المستند."));
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete() {
    setError("");
    setLoading(true);
    try {
      const res = await privateRequest({
        url: `${entityType}/${entityId}/documents/${documentType}`,
        method: "DELETE",
        language,
      });
      onChange(res.data.documents);
    } catch (err) {
      setError((err as Error)?.message || translate("Failed to delete document.", "فشل حذف المستند."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-1 rounded-lg border border-gray-200 p-2 px-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <outlineIcons.Document className="text-gray-500" size={18} />
          <div className="flex flex-col">
            <p className="text-sm font-medium">{getDocumentTypeLabel(documentType, language)}</p>
            <p className="text-xs text-gray-500">
              {document ? document.filename : translate("No document uploaded", "لم يتم تحميل أي مستند")}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {loading && <Loader size="xs" />}

          {document && !loading && (
            <a href={document.url} target="_blank" rel="noopener noreferrer" title={translate("View", "عرض")}>
              <solidIcons.Eye className="text-gray-600 hover:text-blue-600" size={16} />
            </a>
          )}

          {!loading && (
            <Button size="xs" variant="light" onClick={() => inputRef.current?.click()}>
              {document ? translate("Replace", "استبدال") : translate("Upload PDF", "تحميل PDF")}
            </Button>
          )}

          {document && !loading && (
            <button type="button" onClick={handleDelete} title={translate("Delete", "حذف")}>
              <outlineIcons.Trash className="text-red-500 hover:text-red-700" size={16} />
            </button>
          )}

          <input ref={inputRef} type="file" accept=".pdf,application/pdf" hidden onChange={handleFileSelected} />
        </div>
      </div>

      {error && <ErrorAlert error={error} radius="sm" />}
    </div>
  );
}
