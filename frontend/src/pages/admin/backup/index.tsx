import { useEffect, useRef, useState } from "react";
import { useDisclosure } from "@mantine/hooks";
import { ActionIcon, Alert, Badge, Button, Progress, Table, TextInput, Tooltip } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import handleRequest from "@/utils/helpers/handle-request";
import { formatDateAndTime } from "@/utils/helpers/date-formaters";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import EmptySection from "@/components/ui/sections/empty";
import ErrorAlert from "@/components/ui/error-alert";
import { DataTable, DataTableContainer, dataTableHeadClassName } from "@/components/ui/data-table";
import { outlineIcons } from "@/components/icons";
import { BackupOverview, BackupRecord, BackupScope, RestoreRecord } from "@/types/backup";
import ConfirmTextModal from "./_components/confirm-text-modal";

const formatSize = (bytes: number) =>
  bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`;

/**
 * Admin -> Backup & Restore: full system backups (manual and daily) of every business collection AND
 * the actual bytes of every stored file - PDF attachments, customer / vendor documents, project
 * contracts, server images - each written then verified (records and files by checksum) before it
 * counts; downloads; and restoring from a stored or uploaded backup - which REPLACES all current data
 * and puts the files back, after a verified recovery backup is taken automatically. Backups without
 * the external files ("database only", and every backup from before files were included) are
 * labelled as such everywhere. Every endpoint is admin-only on the server.
 */
export default function BackupRestore() {
  const { language, translate, translations } = useLanguage();
  useDocumentTitle(`${translations.nav.backupRestore} | ${translations.adminPanel}`);
  const privateRequest = usePrivateRequest();

  const [overview, setOverview] = useState<BackupOverview | null>(null);
  const [restores, setRestores] = useState<RestoreRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  function load() {
    handleRequest(language, setLoading, setError, async () => {
      const [res, restoresRes] = await Promise.all([
        privateRequest({ url: "admin/backup/backups", language }),
        privateRequest({ url: "admin/backup/restores", language }),
      ]);
      setOverview(res.data);
      setRestores(restoresRes.data || []);
    });
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const kindLabel = (kind: BackupRecord["kind"]) =>
    ({
      manual: translate("Manual", "يدوية"),
      scheduled: translate("Daily", "يومية"),
      "pre-restore": translate("Before restore", "قبل الاستعادة"),
      uploaded: translate("Uploaded", "مرفوعة"),
    })[kind];
  const statusBadge = (status: string) => {
    const map: Record<string, [string, string, string]> = {
      completed: ["green", "Completed", "مكتملة"],
      running: ["blue", "In progress", "قيد التنفيذ"],
      failed: ["red", "Failed", "فشلت"],
      rolled_back: ["orange", "Rolled back", "تم التراجع"],
    };
    const [color, en, ar] = map[status] || ["gray", status, status];
    return (
      <Badge color={color} variant="light" className="min-w-max">
        {translate(en, ar)}
      </Badge>
    );
  };

  const scopeBadge = (b: Pick<BackupRecord, "scope" | "status">) => {
    if (b.status !== "completed" && !b.scope) return "-";
    const map: Record<BackupScope, [string, string, string, string, string]> = {
      full: [
        "teal",
        "Full system",
        "نظام كامل",
        "Database records and every stored file.",
        "سجلات قاعدة البيانات وكل الملفات المخزنة.",
      ],
      partial: [
        "yellow",
        "Partial",
        "جزئية",
        "Taken before a restore while some files were already unreadable - they are not in it.",
        "أُخذت قبل استعادة بينما كانت بعض الملفات غير قابلة للقراءة - ليست ضمنها.",
      ],
      database: [
        "gray",
        "Database only",
        "قاعدة البيانات فقط",
        "Records only: customer / vendor documents, contracts and server images are NOT included and cannot be restored from it.",
        "السجلات فقط: مستندات العملاء والموردين والعقود وصور الخادم غير مضمنة ولا يمكن استعادتها منها.",
      ],
    };
    const [color, en, ar, tipEn, tipAr] = map[b.scope || "database"];
    return (
      <Tooltip label={translate(tipEn, tipAr)} multiline w={300}>
        <Badge color={color} variant="light" className="min-w-max">
          {translate(en, ar)}
        </Badge>
      </Tooltip>
    );
  };

  // ---------------- create
  const [creating, setCreating] = useState<"full" | "database" | null>(null);
  const [failedFiles, setFailedFiles] = useState<BackupRecord["fileFailures"]>([]);
  function createBackup(scope: "full" | "database") {
    setNotice(null);
    setFailedFiles([]);
    handleRequest(
      language,
      (l) => setCreating(l ? scope : null),
      (message) => {
        if (!message) return;
        setNotice({ ok: false, text: message });
        load();
      },
      async () => {
        const res = await privateRequest({ url: "admin/backup/run", method: "POST", data: { scope }, language });
        const b = res.data as BackupRecord;
        const records = b.manifest?.totalDocuments ?? 0;
        const files = b.files?.count ?? 0;
        setNotice({
          ok: true,
          text:
            scope === "full"
              ? translate(
                  `Full backup completed and verified: ${records} records and ${files} files (${formatSize(b.files?.totalBytes || 0)}).`,
                  `اكتملت النسخة الكاملة وتم التحقق منها: ${records} سجل و${files} ملف (${formatSize(b.files?.totalBytes || 0)}).`,
                )
              : translate(
                  `Database backup completed and verified: ${records} records and ${files} attachments stored in the database. Customer / vendor documents, contracts and server images are not included.`,
                  `اكتملت نسخة قاعدة البيانات وتم التحقق منها: ${records} سجل و${files} مرفق مخزن في قاعدة البيانات. مستندات العملاء والموردين والعقود وصور الخادم غير مضمنة.`,
                ),
        });
        load();
      },
    );
  }
  // The latest attempt's unreadable files, named (a full backup is never completed without them).
  useEffect(() => {
    const latest = overview?.backups.find((b) => b.kind !== "uploaded");
    setFailedFiles(latest?.status === "failed" ? latest.fileFailures || [] : []);
  }, [overview]);

  // ---------------- row actions
  const [busyId, setBusyId] = useState<string | null>(null);
  async function download(backup: BackupRecord) {
    setBusyId(backup._id);
    try {
      await privateRequest({
        url: `admin/backup/backups/${backup._id}/download`,
        download: true,
        filename: backup.fileName,
        language,
      });
    } catch (err) {
      setNotice({ ok: false, text: (err as Error)?.message || translate("Download failed.", "فشل التنزيل.") });
    } finally {
      setBusyId(null);
    }
  }
  function verify(backup: BackupRecord) {
    handleRequest(
      language,
      (l) => setBusyId(l ? backup._id : null),
      (message) => message && setNotice({ ok: false, text: message }),
      async () => {
        const res = await privateRequest({ url: `admin/backup/backups/${backup._id}/verify`, method: "POST", language });
        setNotice(
          res.data.ok
            ? { ok: true, text: translate(`"${backup.fileName}" is intact.`, `الملف "${backup.fileName}" سليم.`) }
            : { ok: false, text: `${translate("Verification failed:", "فشل التحقق:")} ${res.data.problems.join("; ")}` },
        );
        load();
      },
    );
  }

  // Delete (type DELETE)
  const [deleteOpened, { open: openDelete, close: closeDelete }] = useDisclosure();
  const [target, setTarget] = useState<BackupRecord | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState("");
  function askDelete(backup: BackupRecord) {
    setTarget(backup);
    setActionError("");
    openDelete();
  }
  function confirmDelete() {
    if (!target) return;
    handleRequest(language, setActionLoading, setActionError, async () => {
      await privateRequest({
        url: `admin/backup/backups/${target._id}`,
        method: "DELETE",
        data: { confirm: "DELETE" },
        language,
      });
      closeDelete();
      load();
    });
  }

  // Restore (type RESTORE)
  const [restoreOpened, { open: openRestore, close: closeRestore }] = useDisclosure();
  function askRestore(backup: BackupRecord) {
    setTarget(backup);
    setActionError("");
    openRestore();
  }
  function confirmRestore() {
    if (!target) return;
    handleRequest(language, setActionLoading, setActionError, async () => {
      const res = await privateRequest({
        url: `admin/backup/backups/${target._id}/restore`,
        method: "POST",
        data: { confirm: "RESTORE" },
        language,
      });
      closeRestore();
      const log = res.data as RestoreRecord;
      const f = log.files;
      const filesEn = f?.total
        ? ` and ${f.total} files (${f.cloudinaryRestored + f.localRestored} put back, the rest already in place)`
        : "";
      const filesAr = f?.total
        ? ` و${f.total} ملف (أُعيد ${f.cloudinaryRestored + f.localRestored} والباقي موجود بالفعل)`
        : "";
      setNotice({
        ok: true,
        text: [
          translate(
            `Restore completed: ${log.documents} records in ${log.collections} collections${filesEn}. A recovery backup of the replaced data was kept.`,
            `اكتملت الاستعادة: ${log.documents} سجل في ${log.collections} مجموعة${filesAr}. تم الاحتفاظ بنسخة استرداد للبيانات المستبدلة.`,
          ),
          ...(log.warnings || []),
        ].join(" "),
      });
      load();
    });
  }

  // ---------------- upload a backup file (in chunks), verified before it can be restored
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  async function upload(file: File) {
    setNotice(null);
    setUploadProgress(0);
    try {
      const started = await privateRequest({
        url: "admin/backup/uploads",
        method: "POST",
        data: { fileName: file.name, sizeBytes: file.size },
        language,
      });
      const { uploadId, chunkBytes } = started.data as { uploadId: string; chunkBytes: number };
      for (let offset = 0, index = 0; offset < file.size; offset += chunkBytes, index += 1) {
        await privateRequest({
          url: `admin/backup/uploads/${uploadId}/chunks/${index}`,
          method: "PUT",
          data: file.slice(offset, offset + chunkBytes),
          language,
        });
        setUploadProgress(Math.min(100, Math.round(((offset + chunkBytes) / file.size) * 100)));
      }
      const done = await privateRequest({ url: `admin/backup/uploads/${uploadId}/complete`, method: "POST", language });
      setNotice({
        ok: true,
        text: translate(
          `"${file.name}" uploaded and verified - it is listed below; choose Restore to use it.`,
          `تم رفع "${file.name}" والتحقق منه - يظهر في القائمة أدناه؛ اختر "استعادة" لاستخدامه.`,
        ),
      });
      void done;
    } catch (err) {
      const e = err as { message?: string; data?: { verification?: { problems?: string[] } } };
      const problems = e?.data?.verification?.problems?.join("; ");
      setNotice({
        ok: false,
        text: `${e?.message || translate("Upload failed.", "فشل الرفع.")}${problems ? ` ${problems}` : ""}`,
      });
    } finally {
      setUploadProgress(null);
      load();
    }
  }

  // ---------------- daily schedule
  const [scheduleTime, setScheduleTime] = useState("");
  const [savingSchedule, setSavingSchedule] = useState(false);
  useEffect(() => {
    if (overview) setScheduleTime(overview.settings.backupTime);
  }, [overview]);
  function saveSchedule() {
    handleRequest(
      language,
      setSavingSchedule,
      (message) => message && setNotice({ ok: false, text: message }),
      async () => {
        await privateRequest({ url: "admin/backup/schedule", method: "POST", data: { time: scheduleTime }, language });
        setNotice({
          ok: true,
          text: translate(`Daily backup time set to ${scheduleTime}.`, `تم ضبط وقت النسخ اليومي على ${scheduleTime}.`),
        });
        load();
      },
    );
  }

  if (loading && !overview)
    return <LoadingSection message={translate("Loading backups...", "جاري تحميل النسخ الاحتياطية...")} />;
  if (error && !overview)
    return (
      <ErrorSection
        errorTitle={translate("Error loading backups", "خطأ في تحميل النسخ الاحتياطية")}
        errorMessage={error}
        button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: load }}
      />
    );
  if (!overview) return null;

  const backups = overview.backups;
  return (
    <AdminLayoutBox
      header={{
        title: translations.nav.backupRestore,
        sideElements: (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="default"
              onClick={() => fileInput.current?.click()}
              disabled={uploadProgress !== null || !!creating}
            >
              {translate("Upload a backup file", "رفع ملف نسخة احتياطية")}
            </Button>
            <Tooltip
              label={translate(
                "Records only - customer / vendor documents, contracts and server images are left out.",
                "السجلات فقط - دون مستندات العملاء والموردين والعقود وصور الخادم.",
              )}
              multiline
              w={260}
            >
              <Button
                variant="default"
                onClick={() => createBackup("database")}
                loading={creating === "database"}
                disabled={uploadProgress !== null || !!creating}
              >
                {translate("Database only", "قاعدة البيانات فقط")}
              </Button>
            </Tooltip>
            <Button
              color="cyan"
              onClick={() => createBackup("full")}
              loading={creating === "full"}
              disabled={uploadProgress !== null || !!creating}
            >
              {translate("Create full backup now", "إنشاء نسخة كاملة الآن")}
            </Button>
          </div>
        ),
      }}
    >
      <input
        ref={fileInput}
        type="file"
        accept=".rsvbak"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) upload(file);
        }}
      />

      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-gray-100 p-3">
          <p className="text-xs text-gray-500">
            {translate("Last full backup (data and files)", "آخر نسخة كاملة (البيانات والملفات)")}
          </p>
          <p className="mt-1 font-semibold">
            {overview.lastFullAt ? formatDateAndTime(overview.lastFullAt, language) : translate("None yet", "لا توجد بعد")}
          </p>
          {overview.lastSuccessfulAt && overview.lastSuccessfulAt !== overview.lastFullAt && (
            <p className="mt-0.5 text-xs text-gray-500">
              {translate("Last backup of any kind:", "آخر نسخة من أي نوع:")}{" "}
              {formatDateAndTime(overview.lastSuccessfulAt, language)}
            </p>
          )}
        </div>
        <div className="rounded-lg border border-gray-100 p-3">
          <p className="text-xs text-gray-500">{translate("Stored in", "مكان الحفظ")}</p>
          <p className="mt-1 font-semibold">
            {overview.storage === "gridfs"
              ? translate(
                  "The database (download copies to keep them off-site)",
                  "قاعدة البيانات (نزّل نسخاً للاحتفاظ بها خارجها)",
                )
              : translate("The server's backup folder", "مجلد النسخ على الخادم")}
          </p>
        </div>
        <div className="rounded-lg border border-gray-100 p-3">
          <p className="text-xs text-gray-500">
            {translate(
              `Daily backup (${overview.settings.timezone}, keeps ${overview.settings.maxFiles})`,
              `النسخ اليومي (${overview.settings.timezone}، يحتفظ بـ ${overview.settings.maxFiles})`,
            )}
          </p>
          <div className="mt-1 flex items-end gap-2">
            <TextInput
              value={scheduleTime}
              onChange={(e) => setScheduleTime(e.target.value)}
              placeholder="HH:mm"
              dir="ltr"
              size="xs"
              className="w-24"
              aria-label={translate("Daily backup time", "وقت النسخ اليومي")}
            />
            <Button
              size="xs"
              variant="light"
              onClick={saveSchedule}
              loading={savingSchedule}
              disabled={!/^\d{2}:\d{2}$/.test(scheduleTime) || scheduleTime === overview.settings.backupTime}
            >
              {translate("Save", "حفظ")}
            </Button>
          </div>
        </div>
      </div>

      {uploadProgress !== null && (
        <div className="mb-4 flex flex-col gap-1">
          <span className="text-sm text-gray-600">
            {translate("Uploading and verifying the backup file...", "جاري رفع ملف النسخة والتحقق منه...")}
          </span>
          <Progress value={uploadProgress} animated />
        </div>
      )}
      {notice &&
        (notice.ok ? (
          <Alert color="green" variant="light" mb="md" withCloseButton onClose={() => setNotice(null)}>
            {notice.text}
          </Alert>
        ) : (
          <div className="mb-4">
            <ErrorAlert error={notice.text} />
          </div>
        ))}

      {!!failedFiles?.length && (
        <Alert
          color="red"
          variant="light"
          mb="md"
          title={translate(
            "The last full backup failed - these files could not be read",
            "فشلت آخر نسخة كاملة - تعذرت قراءة هذه الملفات",
          )}
        >
          <ul className="ms-4 list-disc text-sm">
            {failedFiles.slice(0, 20).map((f) => (
              <li key={`${f.source}:${f.key}`}>
                <span className="font-medium">{f.name || f.key}</span>
                {f.refs.length ? ` - ${f.refs.join(", ")}` : ""}{" "}
                <span className="text-gray-600">
                  ({f.source}: {f.error})
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs">
            {translate(
              "Put the files back (or remove the references to them) and back up again. A database-only backup protects the records meanwhile.",
              "أعد الملفات (أو احذف الإشارات إليها) ثم أعد النسخ. نسخة قاعدة البيانات فقط تحمي السجلات في هذه الأثناء.",
            )}
          </p>
        </Alert>
      )}

      <h4 className="mb-2">{translate("Backups", "النسخ الاحتياطية")}</h4>
      {backups.length === 0 ? (
        <EmptySection
          useDefaultImg
          message={translate("No backups yet. Create the first one.", "لا توجد نسخ احتياطية بعد. أنشئ أول نسخة.")}
        />
      ) : (
        <DataTableContainer>
          <DataTable className="min-w-[1320px] text-sm">
            <Table.Thead className={dataTableHeadClassName}>
              <Table.Tr>
                <Table.Th>{translate("Date", "التاريخ")}</Table.Th>
                <Table.Th>{translate("Type", "النوع")}</Table.Th>
                <Table.Th>{translate("Contents", "المحتوى")}</Table.Th>
                <Table.Th>{translate("Status", "الحالة")}</Table.Th>
                <Table.Th>{translate("Verified", "التحقق")}</Table.Th>
                <Table.Th className="text-end">{translate("Records", "السجلات")}</Table.Th>
                <Table.Th className="text-end">{translate("Files", "الملفات")}</Table.Th>
                <Table.Th className="text-end">{translate("Data / files", "البيانات / الملفات")}</Table.Th>
                <Table.Th className="text-end">{translate("Backup size", "حجم النسخة")}</Table.Th>
                <Table.Th>{translate("By", "بواسطة")}</Table.Th>
                <Table.Th>{translate("Actions", "الإجراءات")}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {backups.map((b) => {
                const usable = b.status === "completed";
                return (
                  <Table.Tr key={b._id}>
                    <Table.Td className="whitespace-nowrap">
                      {formatDateAndTime(b.completedAt || b.startedAt, language)}
                    </Table.Td>
                    <Table.Td>{kindLabel(b.kind)}</Table.Td>
                    <Table.Td className="whitespace-nowrap">{scopeBadge(b)}</Table.Td>
                    <Table.Td className="whitespace-nowrap">
                      <Tooltip label={b.error || ""} disabled={!b.error} multiline w={320}>
                        <span>{statusBadge(b.status)}</span>
                      </Tooltip>
                    </Table.Td>
                    <Table.Td className="whitespace-nowrap">
                      {b.verification?.ok === true ? (
                        <Tooltip
                          label={translate(
                            `Records and ${b.verification.files ?? 0} files match their checksums.`,
                            `السجلات و${b.verification.files ?? 0} ملف مطابقة لبصماتها.`,
                          )}
                        >
                          <Badge color="green" variant="dot" className="min-w-max">
                            {b.scope === "database"
                              ? translate("Records intact", "السجلات سليمة")
                              : translate("Records & files intact", "السجلات والملفات سليمة")}
                          </Badge>
                        </Tooltip>
                      ) : b.verification?.ok === false ? (
                        <Tooltip label={b.verification.problems.join("; ")} multiline w={320}>
                          <Badge color="red" variant="dot" className="min-w-max">
                            {translate("Problems", "مشكلات")}
                          </Badge>
                        </Tooltip>
                      ) : (
                        "-"
                      )}
                    </Table.Td>
                    <Table.Td className="text-end tabular-nums">
                      {b.manifest?.totalDocuments?.toLocaleString("en-US") ?? "-"}
                    </Table.Td>
                    <Table.Td className="text-end tabular-nums">
                      {b.files ? (
                        <Tooltip
                          label={translate(
                            `Attachments ${b.files.sources?.gridfs?.count ?? 0} · Documents ${b.files.sources?.cloudinary?.count ?? 0} · Images ${b.files.sources?.local?.count ?? 0}`,
                            `مرفقات ${b.files.sources?.gridfs?.count ?? 0} · مستندات ${b.files.sources?.cloudinary?.count ?? 0} · صور ${b.files.sources?.local?.count ?? 0}`,
                          )}
                        >
                          <span>{b.files.count.toLocaleString("en-US")}</span>
                        </Tooltip>
                      ) : (
                        "-"
                      )}
                    </Table.Td>
                    <Table.Td className="whitespace-nowrap text-end tabular-nums">
                      {b.manifest?.databaseBytes != null
                        ? `${formatSize(b.manifest.databaseBytes)} / ${formatSize(b.files?.totalBytes || 0)}`
                        : "-"}
                    </Table.Td>
                    <Table.Td className="whitespace-nowrap text-end tabular-nums">
                      {b.sizeBytes ? formatSize(b.sizeBytes) : "-"}
                    </Table.Td>
                    <Table.Td>
                      {b.createdBy?.name || (b.kind === "scheduled" ? translate("System", "النظام") : "-")}
                    </Table.Td>
                    <Table.Td>
                      <div className="flex items-center gap-1.5">
                        <Tooltip label={translate("Download", "تنزيل")}>
                          <ActionIcon
                            variant="light"
                            aria-label={translate("Download", "تنزيل")}
                            disabled={!usable}
                            loading={busyId === b._id}
                            onClick={() => download(b)}
                          >
                            <outlineIcons.ArrowDownOnSquare />
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip label={translate("Verify the file", "التحقق من الملف")}>
                          <ActionIcon
                            variant="light"
                            color="gray"
                            aria-label={translate("Verify the file", "التحقق من الملف")}
                            disabled={!usable || busyId === b._id}
                            onClick={() => verify(b)}
                          >
                            <outlineIcons.ShieldCheck />
                          </ActionIcon>
                        </Tooltip>
                        <Button size="xs" variant="light" color="orange" disabled={!usable} onClick={() => askRestore(b)}>
                          {translate("Restore", "استعادة")}
                        </Button>
                        <Tooltip label={translate("Delete", "حذف")}>
                          <ActionIcon
                            variant="light"
                            color="red"
                            aria-label={translate("Delete", "حذف")}
                            disabled={b.status === "running"}
                            onClick={() => askDelete(b)}
                          >
                            <outlineIcons.Trash />
                          </ActionIcon>
                        </Tooltip>
                      </div>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </DataTable>
        </DataTableContainer>
      )}

      <h4 className="mb-2 mt-6">{translate("Restore history", "سجل الاستعادة")}</h4>
      {restores.length === 0 ? (
        <p className="text-sm text-gray-500">{translate("No restores yet.", "لا توجد عمليات استعادة بعد.")}</p>
      ) : (
        <DataTableContainer>
          <DataTable className="min-w-[760px] text-sm">
            <Table.Thead className={dataTableHeadClassName}>
              <Table.Tr>
                <Table.Th>{translate("Started", "البدء")}</Table.Th>
                <Table.Th>{translate("Backup", "النسخة")}</Table.Th>
                <Table.Th>{translate("Status", "الحالة")}</Table.Th>
                <Table.Th className="text-end">{translate("Records", "السجلات")}</Table.Th>
                <Table.Th className="text-end">{translate("Files", "الملفات")}</Table.Th>
                <Table.Th>{translate("Recovery backup", "نسخة الاسترداد")}</Table.Th>
                <Table.Th>{translate("By", "بواسطة")}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {restores.map((r) => (
                <Table.Tr key={r._id}>
                  <Table.Td className="whitespace-nowrap">{formatDateAndTime(r.startedAt, language)}</Table.Td>
                  <Table.Td className="max-w-[260px] truncate" title={r.backup?.fileName}>
                    {r.backup?.fileName || "-"}
                  </Table.Td>
                  <Table.Td>
                    <Tooltip
                      label={[r.error, ...(r.warnings || [])].filter(Boolean).join(" ")}
                      disabled={!r.error && !r.warnings?.length}
                      multiline
                      w={360}
                    >
                      <span className="inline-flex items-center gap-1">
                        {statusBadge(r.status)}
                        {!!r.warnings?.length && <outlineIcons.ExclamationCircle className="text-yellow-600" />}
                      </span>
                    </Tooltip>
                  </Table.Td>
                  <Table.Td className="text-end tabular-nums">
                    {r.documents ? r.documents.toLocaleString("en-US") : "-"}
                  </Table.Td>
                  <Table.Td className="whitespace-nowrap text-end tabular-nums">
                    {r.status === "completed" && r.files ? (
                      <Tooltip
                        label={translate(
                          `${r.files.cloudinaryRestored + r.files.localRestored} put back from the backup, ${r.files.cloudinaryUnchanged + r.files.localUnchanged} already in place, ${r.files.gridfs} attachments`,
                          `أُعيد ${r.files.cloudinaryRestored + r.files.localRestored} من النسخة، ${r.files.cloudinaryUnchanged + r.files.localUnchanged} موجود بالفعل، ${r.files.gridfs} مرفق`,
                        )}
                      >
                        <span>{r.files.total.toLocaleString("en-US")}</span>
                      </Tooltip>
                    ) : (
                      "-"
                    )}
                  </Table.Td>
                  <Table.Td className="max-w-[240px] truncate" title={r.recoveryBackup?.fileName}>
                    {r.recoveryBackup?.fileName || "-"}
                  </Table.Td>
                  <Table.Td>{r.startedBy?.name || "-"}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </DataTable>
        </DataTableContainer>
      )}

      <ConfirmTextModal
        opened={deleteOpened}
        close={closeDelete}
        title={translate("Delete backup", "حذف النسخة الاحتياطية")}
        word="DELETE"
        actionLabel={translate("Delete permanently", "حذف نهائياً")}
        loading={actionLoading}
        error={actionError}
        onConfirm={confirmDelete}
      >
        <span>
          {translate(
            `The file "${target?.fileName ?? ""}" will be deleted permanently. Its record stays in the history as deleted.`,
            `سيُحذف الملف "${target?.fileName ?? ""}" نهائياً. يبقى سجله في السجل كمحذوف.`,
          )}
        </span>
      </ConfirmTextModal>

      <ConfirmTextModal
        opened={restoreOpened}
        close={closeRestore}
        title={translate("Restore this backup", "استعادة هذه النسخة")}
        word="RESTORE"
        color="orange"
        actionLabel={translate("Replace all data", "استبدال كل البيانات")}
        loading={actionLoading}
        error={actionError}
        onConfirm={confirmRestore}
      >
        <span className="font-semibold">
          {translate("This REPLACES all current data - it does not merge.", "هذا يستبدل كل البيانات الحالية - ولا يدمجها.")}
        </span>
        {target && target.scope !== "full" && (
          <Alert color="yellow" variant="light">
            {target.scope === "partial"
              ? translate(
                  "This backup is partial: some files were already unreadable when it was taken and cannot be put back.",
                  "هذه النسخة جزئية: بعض الملفات كانت غير قابلة للقراءة عند أخذها ولا يمكن إعادتها.",
                )
              : translate(
                  "This backup holds database records only. Attachments stored in the database are included, but customer / vendor documents, contracts and server images are not - they will only work if their files still exist.",
                  "هذه النسخة تحتوي على سجلات قاعدة البيانات فقط. المرفقات المخزنة في قاعدة البيانات مضمنة، أما مستندات العملاء والموردين والعقود وصور الخادم فلا - وستعمل فقط إذا كانت ملفاتها لا تزال موجودة.",
                )}
          </Alert>
        )}
        <span>
          {translate(
            `Every business record (accounts, journal entries, orders, payments, projects, users ...)${target?.scope === "full" ? " and every stored file (attachments, documents, contracts, images)" : ""} will be exactly as in the backup of ${target?.manifest?.createdAt ? formatDateAndTime(target.manifest.createdAt, language) : ""} (${target?.manifest?.totalDocuments?.toLocaleString("en-US") ?? 0} records). Anything entered since is removed.`,
            `ستصبح كل السجلات (الحسابات، القيود، الأوامر، المدفوعات، المشروعات، المستخدمون ...)${target?.scope === "full" ? " وكل الملفات المخزنة (المرفقات والمستندات والعقود والصور)" : ""} كما في النسخة المؤرخة ${target?.manifest?.createdAt ? formatDateAndTime(target.manifest.createdAt, language) : ""} (${target?.manifest?.totalDocuments?.toLocaleString("en-US") ?? 0} سجل). يُحذف كل ما أُدخل بعدها.`,
          )}
        </span>
        <span>
          {translate(
            "Before anything changes, the file is verified again (records and files by checksum) and a verified recovery backup of the current data and files is taken - if the restore fails, data and files are rolled back automatically. A document missing from storage is put back as a new copy; nothing in storage is overwritten. Run it when nobody else is working; users not in the backup will be signed out.",
            "قبل أي تغيير يُعاد التحقق من الملف (السجلات والملفات ببصماتها) وتُؤخذ نسخة استرداد موثقة من البيانات والملفات الحالية - وإذا فشلت الاستعادة يتم التراجع عن البيانات والملفات تلقائياً. المستند المفقود من التخزين يُعاد كنسخة جديدة؛ ولا يُستبدل أي شيء في التخزين. نفّذها عندما لا يعمل أحد آخر؛ سيُسجَّل خروج المستخدمين غير الموجودين في النسخة.",
          )}
        </span>
      </ConfirmTextModal>

      <p className="mt-6 flex items-center gap-1.5 text-xs text-gray-500">
        {translate(
          "Backups contain every business record including user accounts (password hashes) and every attached document - keep downloaded files somewhere safe.",
          "تحتوي النسخ على كل السجلات بما فيها حسابات المستخدمين (كلمات المرور المشفرة) وكل المستندات المرفقة - احفظ الملفات المنزلة في مكان آمن.",
        )}
      </p>
    </AdminLayoutBox>
  );
}
