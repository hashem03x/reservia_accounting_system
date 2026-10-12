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
import { BackupOverview, BackupRecord, RestoreRecord } from "@/types/backup";
import ConfirmTextModal from "./_components/confirm-text-modal";

const formatSize = (bytes: number) =>
  bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`;

/**
 * Admin -> Backup & Restore: full backups of every business collection (manual and daily), each
 * written then verified before it counts; downloads; and restoring from a stored or uploaded backup
 * - which REPLACES all current data, after a verified recovery backup of it is taken automatically.
 * Every endpoint is admin-only on the server.
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
      <Badge color={color} variant="light">
        {translate(en, ar)}
      </Badge>
    );
  };

  // ---------------- create
  const [creating, setCreating] = useState(false);
  function createBackup() {
    setNotice(null);
    handleRequest(
      language,
      setCreating,
      (message) => message && setNotice({ ok: false, text: message }),
      async () => {
        const res = await privateRequest({ url: "admin/backup/run", method: "POST", language });
        setNotice({
          ok: true,
          text: translate(
            `Backup completed and verified: ${res.data.manifest?.totalDocuments ?? 0} records in ${res.data.manifest?.collections?.length ?? 0} collections.`,
            `اكتملت النسخة الاحتياطية وتم التحقق منها: ${res.data.manifest?.totalDocuments ?? 0} سجل في ${res.data.manifest?.collections?.length ?? 0} مجموعة.`,
          ),
        });
        load();
      },
    );
  }

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
      setNotice({
        ok: true,
        text: translate(
          `Restore completed: ${res.data.documents} records in ${res.data.collections} collections. A recovery backup of the replaced data was kept.`,
          `اكتملت الاستعادة: ${res.data.documents} سجل في ${res.data.collections} مجموعة. تم الاحتفاظ بنسخة استرداد للبيانات المستبدلة.`,
        ),
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
              disabled={uploadProgress !== null || creating}
            >
              {translate("Upload a backup file", "رفع ملف نسخة احتياطية")}
            </Button>
            <Button color="cyan" onClick={createBackup} loading={creating} disabled={uploadProgress !== null}>
              {translate("Create backup now", "إنشاء نسخة احتياطية الآن")}
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
          <p className="text-xs text-gray-500">{translate("Last successful backup", "آخر نسخة احتياطية ناجحة")}</p>
          <p className="mt-1 font-semibold">
            {overview.lastSuccessfulAt
              ? formatDateAndTime(overview.lastSuccessfulAt, language)
              : translate("None yet", "لا توجد بعد")}
          </p>
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

      <h4 className="mb-2">{translate("Backups", "النسخ الاحتياطية")}</h4>
      {backups.length === 0 ? (
        <EmptySection
          useDefaultImg
          message={translate("No backups yet. Create the first one.", "لا توجد نسخ احتياطية بعد. أنشئ أول نسخة.")}
        />
      ) : (
        <DataTableContainer>
          <DataTable className="min-w-[900px] text-sm">
            <Table.Thead className={dataTableHeadClassName}>
              <Table.Tr>
                <Table.Th>{translate("Date", "التاريخ")}</Table.Th>
                <Table.Th>{translate("Type", "النوع")}</Table.Th>
                <Table.Th>{translate("Status", "الحالة")}</Table.Th>
                <Table.Th>{translate("Verified", "التحقق")}</Table.Th>
                <Table.Th className="text-end">{translate("Records", "السجلات")}</Table.Th>
                <Table.Th className="text-end">{translate("Size", "الحجم")}</Table.Th>
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
                    <Table.Td>
                      <Tooltip label={b.error || ""} disabled={!b.error} multiline w={320}>
                        <span>{statusBadge(b.status)}</span>
                      </Tooltip>
                    </Table.Td>
                    <Table.Td>
                      {b.verification?.ok === true ? (
                        <Badge color="green" variant="dot">
                          {translate("Intact", "سليمة")}
                        </Badge>
                      ) : b.verification?.ok === false ? (
                        <Tooltip label={b.verification.problems.join("; ")} multiline w={320}>
                          <Badge color="red" variant="dot">
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
                    <Tooltip label={r.error || ""} disabled={!r.error} multiline w={320}>
                      <span>{statusBadge(r.status)}</span>
                    </Tooltip>
                  </Table.Td>
                  <Table.Td className="text-end tabular-nums">
                    {r.documents ? r.documents.toLocaleString("en-US") : "-"}
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
        <span>
          {translate(
            `Every business record (accounts, journal entries, orders, payments, projects, users ...) will be exactly as in the backup of ${target?.manifest?.createdAt ? formatDateAndTime(target.manifest.createdAt, language) : ""} (${target?.manifest?.totalDocuments?.toLocaleString("en-US") ?? 0} records). Anything entered since is removed.`,
            `ستصبح كل السجلات (الحسابات، القيود، الأوامر، المدفوعات، المشروعات، المستخدمون ...) كما في النسخة المؤرخة ${target?.manifest?.createdAt ? formatDateAndTime(target.manifest.createdAt, language) : ""} (${target?.manifest?.totalDocuments?.toLocaleString("en-US") ?? 0} سجل). يُحذف كل ما أُدخل بعدها.`,
          )}
        </span>
        <span>
          {translate(
            "Before anything changes, the file is verified again and a verified recovery backup of the current data is taken - if the restore fails it is rolled back automatically. Run it when nobody else is working; users not in the backup will be signed out.",
            "قبل أي تغيير يُعاد التحقق من الملف وتُؤخذ نسخة استرداد موثقة من البيانات الحالية - وإذا فشلت الاستعادة يتم التراجع عنها تلقائياً. نفّذها عندما لا يعمل أحد آخر؛ سيُسجَّل خروج المستخدمين غير الموجودين في النسخة.",
          )}
        </span>
      </ConfirmTextModal>

      <p className="mt-6 flex items-center gap-1.5 text-xs text-gray-500">
        {translate(
          "Backups contain every business record including user accounts (password hashes) - keep downloaded files somewhere safe.",
          "تحتوي النسخ على كل السجلات بما فيها حسابات المستخدمين (كلمات المرور المشفرة) - احفظ الملفات المنزلة في مكان آمن.",
        )}
      </p>
    </AdminLayoutBox>
  );
}
