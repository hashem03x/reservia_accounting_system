import { useRef, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import { Project, ProjectContract } from "@/types/project";
import { Button, Loader } from "@mantine/core";
import { outlineIcons, solidIcons } from "@/components/icons";
import ErrorAlert from "@/components/ui/error-alert";
import { formatDateAndTime } from "@/utils/helpers/date-formaters";

const pdfMimeType = "application/pdf";

export default function ProjectContractSection({
  project,
  onChange,
}: {
  project: Project;
  onChange: (contract: ProjectContract | null) => void;
}) {
  const { language, translate } = useLanguage();
  const privateRequest = usePrivateRequest();
  const inputRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    if (file.type !== pdfMimeType || !file.name.toLowerCase().endsWith(".pdf")) {
      setError(translate("Only PDF files are allowed.", "يُسمح فقط بملفات PDF."));
      return;
    }

    setError("");
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append("contract", file);

      const res = await privateRequest({
        url: `projects/${project._id}/contract`,
        method: "POST",
        data: formData,
        language,
      });

      onChange(res.data.contract);
    } catch (err) {
      setError((err as Error)?.message || translate("Failed to upload contract.", "فشل تحميل العقد."));
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete() {
    setError("");
    setLoading(true);
    try {
      await privateRequest({ url: `projects/${project._id}/contract`, method: "DELETE", language });
      onChange(null);
    } catch (err) {
      setError((err as Error)?.message || translate("Failed to remove contract.", "فشل حذف العقد."));
    } finally {
      setLoading(false);
    }
  }

  const contract = project.contract;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-gray-200 p-3">
      <h4>{translate("Contract", "العقد")}</h4>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <outlineIcons.Document className="text-gray-500" size={20} />
          <div className="flex flex-col">
            <p className="text-sm font-medium">{contract ? contract.filename : translate("No contract uploaded", "لم يتم تحميل عقد")}</p>
            {contract && (
              <p className="text-xs text-gray-500">
                {translate("Uploaded", "تم الرفع")} {formatDateAndTime(contract.uploadedAt, language)}
                {contract.uploadedBy?.name ? ` ${translate("by", "بواسطة")} ${contract.uploadedBy.name}` : ""}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {loading && <Loader size="xs" />}

          {contract && !loading && (
            <a href={contract.url} target="_blank" rel="noopener noreferrer" title={translate("View / Download", "عرض / تحميل")}>
              <solidIcons.Eye className="text-gray-600 hover:text-blue-600" size={18} />
            </a>
          )}

          {!loading && (
            <Button size="xs" variant="light" onClick={() => inputRef.current?.click()}>
              {contract ? translate("Replace", "استبدال") : translate("Upload PDF", "تحميل PDF")}
            </Button>
          )}

          {contract && !loading && (
            <button type="button" onClick={handleDelete} title={translate("Remove", "حذف")}>
              <outlineIcons.Trash className="text-red-500 hover:text-red-700" size={18} />
            </button>
          )}

          <input ref={inputRef} type="file" accept=".pdf,application/pdf" hidden onChange={handleFileSelected} />
        </div>
      </div>

      {error && <ErrorAlert error={error} radius="sm" />}
    </div>
  );
}
