import { useRef, useState } from "react";
import { Alert, Badge, Button, Stepper, Table } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import { notifyError, notifySuccess } from "@/utils/helpers/notifiers";
import { outlineIcons, solidIcons } from "@/components/icons";
import Modal from "@/components/ui/modal";
import { DataTable, DataTableContainer, dataTableHeadClassName } from "@/components/ui/data-table";
import { exportRowsToCsv } from "@/utils/helpers/csv-export";
import { CsvCommitResult, CsvPreviewResult, CsvRowError, ApiErrorPayload } from "./types";

const MAX_FILE_BYTES = 5 * 1024 * 1024; // mirrors backend/server/utils/csvImport/limits.js

// The guided CSV import workflow (docs section "Build a Safe CSV Import Workflow") - the first
// multi-step modal in this codebase (no Stepper usage existed anywhere before this). Generic over
// {previewUrl, commitUrl}; each module's list page supplies its own three endpoints/labels/sample
// button - this component holds no module-specific business rules.
export default function ImportWizardModal({
  opened,
  close,
  title,
  previewUrl,
  commitUrl,
  onImported,
}: {
  opened: boolean;
  close: () => void;
  title: string;
  previewUrl: string;
  commitUrl: string;
  onImported?: () => void;
}) {
  const { language, translate } = useLanguage();
  const privateRequest = usePrivateRequest();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [preview, setPreview] = useState<CsvPreviewResult | null>(null);

  const [commitLoading, setCommitLoading] = useState(false);
  const [commitError, setCommitError] = useState("");
  const [result, setResult] = useState<CsvCommitResult | null>(null);

  function resetAll() {
    setStep(0);
    setFile(null);
    setPreviewLoading(false);
    setPreviewError("");
    setPreview(null);
    setCommitLoading(false);
    setCommitError("");
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleClose() {
    close();
    setTimeout(resetAll, 250);
  }

  async function handleFile(selected: File | null) {
    if (!selected) return;
    if (!selected.name.toLowerCase().endsWith(".csv")) {
      notifyError({ language, message: translate("Please select a .csv file.", "يرجى اختيار ملف .csv.") });
      return;
    }
    if (selected.size > MAX_FILE_BYTES) {
      notifyError({
        language,
        message: translate(`File is too large. Maximum size is ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB.`, `الملف كبير جداً. الحد الأقصى ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} ميجابايت.`),
      });
      return;
    }
    setFile(selected);
    await runPreview(selected);
  }

  async function runPreview(selected: File) {
    const formData = new FormData();
    formData.append("file", selected);
    setPreviewLoading(true);
    setPreviewError("");
    try {
      const res = await privateRequest({ url: previewUrl, method: "POST", data: formData, language });
      setPreview(res.data as CsvPreviewResult);
      setStep(1);
    } catch (err) {
      setPreviewError((err as ApiErrorPayload)?.message || translate("Could not read this file.", "تعذر قراءة هذا الملف."));
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleConfirm() {
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    setCommitLoading(true);
    setCommitError("");
    try {
      const res = await privateRequest({ url: commitUrl, method: "POST", data: formData, language });
      setResult(res.data as CsvCommitResult);
      setStep(2);
      notifySuccess({ language, message: translate(`Imported ${res.data.created.length} record(s).`, `تم استيراد ${res.data.created.length} سجل.`) });
      onImported?.();
    } catch (err) {
      const payload = err as ApiErrorPayload;
      if (payload?.validationErrors) {
        // "No records could be imported" - still a real result, not a transport error: show it
        // on the Result step like any other outcome, never a silent dead end.
        setResult({ created: [], failed: payload.validationErrors });
        setStep(2);
      } else {
        setCommitError(payload?.message || translate("Import failed.", "فشل الاستيراد."));
      }
    } finally {
      setCommitLoading(false);
    }
  }

  function downloadErrorReport(rows: { row: number; errors: CsvRowError[] }[]) {
    const lines = rows.flatMap(r => r.errors.map(e => [r.row, e.column || "", e.value != null ? String(e.value) : "", e.message, e.suggestion || ""]));
    exportRowsToCsv(`import-errors-${Date.now()}.csv`, ["Row", "Column", "Value", "Problem", "Suggestion"], lines);
  }

  return (
    <Modal opened={opened} onClose={handleClose} title={title} size="xl">
      <Stepper active={step} onStepClick={undefined} allowNextStepsSelect={false}>
        <Stepper.Step label={translate("Upload", "رفع الملف")} description={translate("Select a CSV file", "اختر ملف CSV")}>
          <div
            onDragOver={e => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => {
              e.preventDefault();
              setDragOver(false);
              handleFile(e.dataTransfer.files?.[0] || null);
            }}
            className={`mt-4 flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-10 text-center ${dragOver ? "border-cyan-500 bg-cyan-50" : "border-gray-300"}`}
          >
            <outlineIcons.ArrowUpOnSquare size={32} className="text-gray-400" />
            <p className="text-sm text-gray-600">{translate("Drag and drop a CSV file here, or", "اسحب ملف CSV هنا، أو")}</p>
            <input
              type="file"
              accept=".csv"
              ref={fileInputRef}
              onChange={e => handleFile(e.target.files?.[0] || null)}
              style={{ display: "none" }}
            />
            <Button variant="light" loading={previewLoading} onClick={() => fileInputRef.current?.click()}>
              {translate("Choose File", "اختر ملفاً")}
            </Button>
            {previewError && <Alert color="red" variant="light">{previewError}</Alert>}
          </div>
        </Stepper.Step>

        <Stepper.Step label={translate("Preview & Validate", "معاينة وتحقق")} description={translate("Review before confirming", "راجع قبل التأكيد")}>
          {preview && (
            <div className="mt-4 flex flex-col gap-4">
              <div className="flex flex-wrap gap-4 text-sm">
                <span>{translate("Total rows", "إجمالي الصفوف")}: <b>{preview.totalRows}</b></span>
                <span className="text-green-700">{translate("Valid", "صحيح")}: <b>{preview.validCount}</b></span>
                <span className="text-red-600">{translate("Invalid", "غير صحيح")}: <b>{preview.invalidCount}</b></span>
              </div>

              {preview.invalidCount > 0 && (
                <Alert color="yellow" variant="light" title={translate("Some rows have errors", "بعض الصفوف بها أخطاء")}>
                  <div className="flex flex-col gap-2">
                    <p>
                      {translate(
                        "Valid rows can still be imported independently - invalid rows will simply be skipped and reported below.",
                        "يمكن استيراد الصفوف الصحيحة بشكل مستقل - سيتم تخطي الصفوف غير الصحيحة والإشارة إليها أدناه.",
                      )}
                    </p>
                    <Button size="xs" variant="light" color="yellow" onClick={() => downloadErrorReport(preview.errors)} className="self-start">
                      {translate("Download Error Report", "تحميل تقرير الأخطاء")}
                    </Button>
                  </div>
                </Alert>
              )}

              <DataTableContainer>
                <DataTable className="min-w-[700px]">
                  <Table.Thead className={dataTableHeadClassName}>
                    <Table.Tr>
                      <Table.Th>{translate("Row", "الصف")}</Table.Th>
                      {preview.columns.slice(0, 5).map(c => (
                        <Table.Th key={c}>{c}</Table.Th>
                      ))}
                      <Table.Th>{translate("Status", "الحالة")}</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {preview.previewRows.map(r => (
                      <Table.Tr key={r.row}>
                        <Table.Td>{r.row}</Table.Td>
                        {preview.columns.slice(0, 5).map(c => (
                          <Table.Td key={c} className="whitespace-nowrap">{r.data[c] || "-"}</Table.Td>
                        ))}
                        <Table.Td>
                          {r.errors.length === 0 ? (
                            <Badge color="green" variant="light">{translate("Valid", "صحيح")}</Badge>
                          ) : (
                            <Badge color="red" variant="light" title={r.errors.map(e => e.message).join("; ")}>
                              {r.errors.length} {translate("error(s)", "خطأ")}
                            </Badge>
                          )}
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </DataTable>
              </DataTableContainer>

              {commitError && <Alert color="red" variant="light">{commitError}</Alert>}

              <div className="flex justify-between">
                <Button variant="light" color="gray" onClick={() => setStep(0)}>
                  {translate("Back", "رجوع")}
                </Button>
                <Button loading={commitLoading} disabled={preview.validCount === 0} onClick={handleConfirm}>
                  {translate(`Confirm Import (${preview.validCount} row(s))`, `تأكيد الاستيراد (${preview.validCount} صف)`)}
                </Button>
              </div>
            </div>
          )}
        </Stepper.Step>

        <Stepper.Step label={translate("Result", "النتيجة")} description={translate("Import complete", "اكتمل الاستيراد")}>
          {result && (
            <div className="mt-4 flex flex-col gap-4">
              <div className="flex flex-wrap gap-4 text-sm">
                <span className="text-green-700">{translate("Imported", "تم استيراد")}: <b>{result.created.length}</b></span>
                <span className="text-red-600">{translate("Failed", "فشل")}: <b>{result.failed.length}</b></span>
              </div>

              {result.failed.length > 0 && (
                <Alert color={result.created.length === 0 ? "red" : "yellow"} variant="light" title={translate("Some rows were not imported", "لم يتم استيراد بعض الصفوف")}>
                  <div className="flex flex-col gap-2">
                    <Table striped>
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>{translate("Row", "الصف")}</Table.Th>
                          <Table.Th>{translate("Reason", "السبب")}</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {result.failed.map(f => (
                          <Table.Tr key={f.row}>
                            <Table.Td>{f.row}</Table.Td>
                            <Table.Td>{f.errors.map(e => e.message).join("; ")}</Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                    <Button size="xs" variant="light" color="red" onClick={() => downloadErrorReport(result.failed)} className="self-start">
                      {translate("Download Error Report", "تحميل تقرير الأخطاء")}
                    </Button>
                  </div>
                </Alert>
              )}

              <div className="flex justify-end gap-2">
                <Button variant="light" onClick={resetAll} leftSection={<solidIcons.ArrowPath />}>
                  {translate("Import Another File", "استيراد ملف آخر")}
                </Button>
                <Button onClick={handleClose}>{translate("Done", "تم")}</Button>
              </div>
            </div>
          )}
        </Stepper.Step>
      </Stepper>
    </Modal>
  );
}
