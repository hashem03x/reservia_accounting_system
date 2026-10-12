import { useRef, useState } from "react";
import { Button } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import { outlineIcons } from "@/components/icons";
import ErrorAlert from "@/components/ui/error-alert";
import { AttachmentLimits } from "@/types/attachment";
import { checkPdf, DEFAULT_LIMITS, formatBytes } from "./use-attachment-upload";

/**
 * Optional "Attachments / مرفقات" section of a create form: PDFs chosen here are kept in the form and
 * uploaded right after the record is saved (uploadPendingAttachments) - a file is never stored
 * before its record exists. Shows each file's name and size and lets it be removed before saving.
 */
export default function AttachmentPicker({
  files,
  onChange,
  limits = DEFAULT_LIMITS,
  disabled = false,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  limits?: AttachmentLimits;
  disabled?: boolean;
}) {
  const { translate } = useLanguage();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");

  function add(e: React.ChangeEvent<HTMLInputElement>) {
    const chosen = Array.from(e.target.files || []);
    e.target.value = "";
    const problems: string[] = [];
    const next = [...files];
    for (const file of chosen) {
      const problem = checkPdf(file, limits, translate);
      if (problem) problems.push(problem);
      else if (next.some((f) => f.name === file.name && f.size === file.size))
        problems.push(translate(`"${file.name}" is already chosen.`, `"${file.name}" مختار بالفعل.`));
      else if (next.length >= limits.maxFiles)
        problems.push(
          translate(`At most ${limits.maxFiles} files can be attached.`, `يمكن إرفاق ${limits.maxFiles} ملفات كحد أقصى.`),
        );
      else next.push(file);
    }
    setError(problems.join(" "));
    onChange(next);
  }

  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4>{translate("Attachments (optional)", "المرفقات (اختياري)")}</h4>
          <p className="text-xs text-gray-500">
            {translate(
              `PDF only, up to ${formatBytes(limits.maxBytes)} each. Uploaded when the record is saved.`,
              `ملفات PDF فقط، حتى ${formatBytes(limits.maxBytes)} لكل ملف. تُرفع عند الحفظ.`,
            )}
          </p>
        </div>
        <Button
          size="xs"
          variant="light"
          leftSection={<outlineIcons.Document size={16} />}
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
        >
          {translate("Choose PDFs", "اختر ملفات PDF")}
        </Button>
        <input ref={inputRef} type="file" accept=".pdf,application/pdf" multiple hidden onChange={add} />
      </div>

      {files.length > 0 && (
        <ul className="flex flex-col divide-y divide-gray-100 rounded-md border border-gray-100">
          {files.map((file) => (
            <li key={`${file.name}-${file.size}`} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                <outlineIcons.Document className="shrink-0 text-red-500" size={18} />
                <span className="truncate" title={file.name} dir="auto">
                  {file.name}
                </span>
                <span className="shrink-0 text-xs text-gray-500">{formatBytes(file.size)}</span>
              </span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(files.filter((f) => f !== file))}
                title={translate("Remove", "إزالة")}
                aria-label={translate(`Remove ${file.name}`, `إزالة ${file.name}`)}
              >
                <outlineIcons.Trash className="text-red-500 hover:text-red-700" size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <ErrorAlert error={error} radius="sm" />}
    </section>
  );
}
