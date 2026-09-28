import { useEffect, useRef, useState } from "react";
import { ActionIcon, Badge, Button, Loader, Table, TextInput, Tooltip } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import ErrorAlert from "@/components/ui/error-alert";
import { solidIcons } from "@/components/icons";
import { notifySuccess, notifyError } from "@/utils/helpers/notifiers";

// ─── Types ───────────────────────────────────────────────────────────────────

interface BackupSettings {
  backupTime: string;
  timezone: string;
  maxFiles: number;
}

interface BackupFile {
  name: string;
  sizeBytes: number;
  createdAt: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function formatDate(iso: string, language: string): string {
  try {
    return new Intl.DateTimeFormat(language, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Africa/Cairo",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function BackupSection() {
  const { translate, language } = useLanguage();

  // ── Settings state ────────────────────────────────────────────────────────
  const {
    privateRequest,
    loading: settingsLoading,
    setLoading: setSettingsLoading,
    error: settingsError,
    setError: setSettingsError,
    data: settings,
    setData: setSettings,
  } = useDataHandler<BackupSettings | null>({ initialData: null });

  const [timeInput, setTimeInput] = useState("");
  const [timeInputError, setTimeInputError] = useState("");
  const [saveLoading, setSaveLoading] = useState(false);

  // ── Files state ───────────────────────────────────────────────────────────
  const {
    privateRequest: filesRequest,
    loading: filesLoading,
    setLoading: setFilesLoading,
    error: filesError,
    setError: setFilesError,
    data: files,
    setData: setFiles,
  } = useDataHandler<BackupFile[]>({ initialData: [] });

  const [downloadingFile, setDownloadingFile] = useState<string | null>(null);

  const canceled = useRef({ current: false });

  // ── Fetch settings on mount ───────────────────────────────────────────────
  useEffect(() => {
    const ref = canceled.current;
    handleRequest(language, setSettingsLoading, setSettingsError, async () => {
      const res = await privateRequest({ url: "admin/backup/settings", method: "GET", language });
      if (res?.data) {
        setSettings(res.data);
        setTimeInput(res.data.backupTime);
      }
    });
    return () => {
      ref.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Fetch files on mount ──────────────────────────────────────────────────
  useEffect(() => {
    loadFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function loadFiles() {
    handleRequest(language, setFilesLoading, setFilesError, async () => {
      const res = await filesRequest({ url: "admin/backup/files", method: "GET", language });
      if (res?.data) setFiles(res.data);
    });
  }

  // ── Save schedule ─────────────────────────────────────────────────────────
  function handleSaveSchedule() {
    setTimeInputError("");
    const valid = /^\d{2}:\d{2}$/.test(timeInput);
    if (!valid) {
      setTimeInputError(translate("Expected format: HH:mm (e.g. 03:00)", "الصيغة المتوقعة: HH:mm (مثال: 03:00)"));
      return;
    }
    const [h, m] = timeInput.split(":").map(Number);
    if (h > 23 || m > 59) {
      setTimeInputError(translate("Invalid time value.", "قيمة الوقت غير صالحة."));
      return;
    }

    handleRequest(
      language,
      setSaveLoading,
      () => {},
      async () => {
        await privateRequest({
          url: "admin/backup/schedule",
          method: "POST",
          data: { time: timeInput },
          language,
        });
        setSettings((prev) => (prev ? { ...prev, backupTime: timeInput } : prev));
        notifySuccess({ language, message: translate("Backup schedule updated.", "تم تحديث جدول النسخ الاحتياطي.") });
      },
    );
  }

  // ── Download a backup file ────────────────────────────────────────────────
  function handleDownload(filename: string) {
    if (downloadingFile) return;
    setDownloadingFile(filename);
    privateRequest({
      url: `admin/backup/files/${filename}`,
      method: "GET",
      download: true,
      filename,
      language,
    })
      .catch(() => {
        notifyError({ language, message: translate("Failed to download backup.", "فشل تنزيل النسخة الاحتياطية.") });
      })
      .finally(() => setDownloadingFile(null));
  }

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <>
      <hr />

      {/* ── Automated Backup Section ── */}
      <div className="flex flex-col gap-4">
        <header className="flex flex-col gap-2">
          <h3>{translate("Automated Database Backup", "النسخ الاحتياطي التلقائي لقاعدة البيانات")}</h3>
          <p className="text-sm text-gray-500">
            {translate(
              "The system automatically exports all collections to a .tar.gz archive on a daily schedule. Backups are saved locally and the latest 10 are kept.",
              "يقوم النظام تلقائياً بتصدير جميع المجموعات إلى أرشيف .tar.gz يومياً. يتم الاحتفاظ بآخر 10 نسخ.",
            )}
          </p>
        </header>

        {/* ── Schedule editor ── */}
        <div className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
          <p className="text-sm font-medium text-gray-700">
            {translate("Daily backup time (Africa/Cairo)", "وقت النسخ الاحتياطي اليومي (القاهرة)")}
          </p>

          {settingsLoading && (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Loader size="xs" />
              <span>{translate("Loading settings...", "جاري تحميل الإعدادات...")}</span>
            </div>
          )}

          {!settingsLoading && (
            <div className="flex flex-wrap items-end gap-3">
              <TextInput
                id="backup-time-input"
                placeholder="HH:mm"
                value={timeInput}
                onChange={(e) => setTimeInput(e.currentTarget.value)}
                error={timeInputError}
                style={{ width: 120 }}
                maxLength={5}
                radius="md"
                description={
                  settings ? translate(`Current: ${settings.backupTime}`, `الحالي: ${settings.backupTime}`) : undefined
                }
              />
              <Button
                variant="light"
                color="blue"
                radius="md"
                loading={saveLoading}
                onClick={handleSaveSchedule}
                mb={timeInputError ? 18 : 0}
              >
                {translate("Save", "حفظ")}
              </Button>
            </div>
          )}

          {settingsError && <ErrorAlert error={settingsError} />}
        </div>

        {/* ── File list ── */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-gray-700">{translate("Stored Backups", "النسخ الاحتياطية المخزّنة")}</p>
            <Tooltip label={translate("Refresh list", "تحديث القائمة")} withArrow>
              <ActionIcon
                variant="subtle"
                color="gray"
                onClick={loadFiles}
                loading={filesLoading}
                aria-label="refresh-backups"
              >
                <solidIcons.ArrowPath className="h-4 w-4" />
              </ActionIcon>
            </Tooltip>
          </div>

          {filesLoading && (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Loader size="xs" />
              <span>{translate("Loading backups...", "جاري تحميل النسخ الاحتياطية...")}</span>
            </div>
          )}

          {filesError && <ErrorAlert error={filesError} />}

          {!filesLoading && !filesError && files.length === 0 && (
            <p className="text-sm italic text-gray-400">
              {translate("No backup files found.", "لا توجد نسخ احتياطية بعد.")}
            </p>
          )}

          {!filesLoading && files.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-gray-200">
              <Table highlightOnHover withTableBorder={false} withColumnBorders={false}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{translate("File", "الملف")}</Table.Th>
                    <Table.Th>{translate("Size", "الحجم")}</Table.Th>
                    <Table.Th>{translate("Created", "تاريخ الإنشاء")}</Table.Th>
                    <Table.Th style={{ width: 48 }} />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {files.map((file, idx) => (
                    <Table.Tr key={file.name}>
                      <Table.Td>
                        <div className="flex items-center gap-2">
                          <span className="break-all font-mono text-xs text-gray-700">{file.name}</span>
                          {idx === 0 && (
                            <Badge size="xs" color="teal" variant="light">
                              {translate("Latest", "الأحدث")}
                            </Badge>
                          )}
                        </div>
                      </Table.Td>
                      <Table.Td>
                        <span className="text-sm text-gray-500">{formatBytes(file.sizeBytes)}</span>
                      </Table.Td>
                      <Table.Td>
                        <span className="text-sm text-gray-500">{formatDate(file.createdAt, language)}</span>
                      </Table.Td>
                      <Table.Td>
                        <Tooltip label={translate("Download", "تنزيل")} withArrow>
                          <ActionIcon
                            variant="subtle"
                            color="blue"
                            loading={downloadingFile === file.name}
                            disabled={!!downloadingFile && downloadingFile !== file.name}
                            onClick={() => handleDownload(file.name)}
                            aria-label={`download-${file.name}`}
                          >
                            <solidIcons.Download className="h-4 w-4" />
                          </ActionIcon>
                        </Tooltip>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
