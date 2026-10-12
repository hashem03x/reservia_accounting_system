import { useEffect, useMemo, useState } from "react";
import { useDisclosure } from "@mantine/hooks";
import { ActionIcon, Alert, Badge, Button, Select, Table, TextInput, Tooltip } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useProjectManagers from "@/hooks/useProjectManagers";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import handleRequest from "@/utils/helpers/handle-request";
import { formatDate } from "@/utils/helpers/date-formaters";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import EmptySection from "@/components/ui/sections/empty";
import DeleteModal from "@/components/ui/delete-modal";
import TruncatedText from "@/components/ui/truncated-text";
import { DataTable, DataTableContainer, dataTableHeadClassName } from "@/components/ui/data-table";
import { outlineIcons, solidIcons } from "@/components/icons";
import { LegacyProjectManager, ProjectManager } from "@/types/project-manager";
import ProjectManagerModal from "./_components/project-manager-modal";

type StatusFilter = "all" | "active" | "inactive";

/**
 * Admin -> Project Managers: the people projects can be assigned to (admin-only page and API). One
 * assigned to any project cannot be deleted - deactivate them instead, which keeps them on those
 * projects but removes them from the Project forms.
 */
export default function ProjectManagers() {
  const { language, translate, translations } = useLanguage();
  useDocumentTitle(`${translations.pages.projectManagers} | ${translations.adminPanel}`);
  const privateRequest = usePrivateRequest();

  const { projectManagers, loading, error, reload, createProjectManager, updateProjectManager, deleteProjectManager } =
    useProjectManagers();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const visible = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase();
    return projectManagers.filter(
      (m) =>
        (!keyword || [m.name, m.email, m.phone].some((v) => v && v.toLocaleLowerCase().includes(keyword))) &&
        (statusFilter === "all" || (statusFilter === "active") === m.isActive),
    );
  }, [projectManagers, search, statusFilter]);

  // Managers existing projects still reference as staff users (before this list existed).
  const [legacy, setLegacy] = useState<LegacyProjectManager[]>([]);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const [importMessage, setImportMessage] = useState("");
  async function loadLegacy() {
    try {
      const res = await privateRequest({ url: "project-managers/legacy", language });
      setLegacy(Array.isArray(res?.data) ? res.data : []);
    } catch {
      setLegacy([]);
    }
  }
  useEffect(() => {
    loadLegacy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function importLegacy() {
    handleRequest(language, setImporting, setImportError, async () => {
      const res = await privateRequest({ url: "project-managers/legacy/import", method: "POST", language });
      const { imported, skipped } = res.data as { imported: unknown[]; skipped: unknown[] };
      setImportMessage(
        translate(
          `${imported.length} project manager(s) added.${skipped.length ? ` ${skipped.length} need your review (missing user or duplicate name / email).` : ""}`,
          `تمت إضافة ${imported.length} من مديري المشروعات.${skipped.length ? ` ${skipped.length} يحتاج إلى مراجعتك (مستخدم غير موجود أو اسم / بريد مكرر).` : ""}`,
        ),
      );
      await Promise.all([reload(), loadLegacy()]);
    });
  }
  const importable = legacy.filter((l) => l.userFound);

  // Create / edit
  const [formOpened, { open: openForm, close: closeForm }] = useDisclosure();
  const [editing, setEditing] = useState<ProjectManager | null>(null);
  function openCreate() {
    setEditing(null);
    openForm();
  }
  function openEdit(manager: ProjectManager) {
    setEditing(manager);
    openForm();
  }

  // Delete (unassigned project managers only)
  const [deleteOpened, { open: openDelete, close: closeDelete }] = useDisclosure();
  const [deleting, setDeleting] = useState<ProjectManager | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  function askDelete(manager: ProjectManager) {
    setDeleting(manager);
    setDeleteError("");
    openDelete();
  }
  function confirmDelete() {
    if (!deleting || deleteLoading) return;
    handleRequest(language, setDeleteLoading, setDeleteError, async () => {
      await deleteProjectManager(deleting._id);
      closeDelete();
    });
  }

  // Activate / deactivate (row action)
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState("");
  function toggleActive(manager: ProjectManager) {
    if (togglingId) return;
    handleRequest(
      language,
      (isLoading) => setTogglingId(isLoading ? manager._id : null),
      setToggleError,
      async () => {
        await updateProjectManager(manager._id, { isActive: !manager.isActive });
      },
    );
  }

  return (
    <AdminLayoutBox
      header={{
        title: translations.pages.projectManagers,
        sideElements: (
          <Button color="cyan" variant="light" onClick={openCreate} className="w-full sm:w-auto">
            {translate("Add Project Manager", "إضافة مدير مشروع")}
          </Button>
        ),
      }}
    >
      {importable.length > 0 && (
        <Alert
          color="blue"
          variant="light"
          mb="md"
          title={translate("Project managers from existing projects", "مديرو مشروعات من المشروعات الحالية")}
        >
          <div className="flex flex-col gap-2 text-sm">
            <span>
              {translate(
                `${importable.length} project manager(s) assigned to existing projects are not in this list yet (${importable.map((l) => l.name).join(", ")}). Add them so those projects show and keep their manager - no project is changed.`,
                `${importable.length} من مديري المشروعات المعينين على مشروعات حالية غير موجودين في هذه القائمة بعد (${importable.map((l) => l.name).join("، ")}). أضفهم لتظهر تلك المشروعات بمديرها - دون تغيير أي مشروع.`,
              )}
            </span>
            <div>
              <Button size="xs" onClick={importLegacy} loading={importing}>
                {translate("Add them to the list", "إضافتهم إلى القائمة")}
              </Button>
            </div>
          </div>
        </Alert>
      )}
      {importError && (
        <p
          className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400"
          role="alert"
        >
          {importError}
        </p>
      )}
      {importMessage && (
        <p
          className="mb-3 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-950/40 dark:text-green-400"
          role="status"
        >
          {importMessage}
        </p>
      )}

      {loading ? (
        <LoadingSection message={translate("Loading project managers...", "جاري تحميل مديري المشروعات...")} />
      ) : error ? (
        <ErrorSection
          errorTitle={translate("Error loading project managers", "خطأ في تحميل مديري المشروعات")}
          errorMessage={error}
          button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: reload }}
        />
      ) : projectManagers.length === 0 ? (
        <EmptySection
          useDefaultImg
          message={translate("No project managers yet. Add the first one.", "لا يوجد مديرو مشروعات بعد. أضف أول مدير.")}
        />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            <TextInput
              placeholder={translate("Search by name, email or phone", "ابحث بالاسم أو البريد أو الهاتف")}
              leftSection={<solidIcons.Search />}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full sm:w-[300px]"
            />
            <Select
              value={statusFilter}
              onChange={(v) => setStatusFilter((v as StatusFilter) || "all")}
              data={[
                { value: "all", label: translate("All statuses", "كل الحالات") },
                { value: "active", label: translate("Active", "نشط") },
                { value: "inactive", label: translate("Inactive", "غير نشط") },
              ]}
              allowDeselect={false}
              className="w-full sm:w-[180px]"
            />
          </div>

          {toggleError && (
            <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600" role="alert">
              {toggleError}
            </p>
          )}

          {visible.length === 0 ? (
            <EmptySection
              useDefaultImg
              message={translate("No project managers match your search.", "لا يوجد مديرو مشروعات مطابقون.")}
            />
          ) : (
            <DataTableContainer>
              <DataTable className="min-w-[860px]">
                <Table.Thead className={dataTableHeadClassName}>
                  <Table.Tr>
                    <Table.Th>{translate("Name", "الاسم")}</Table.Th>
                    <Table.Th>{translate("Email", "البريد الإلكتروني")}</Table.Th>
                    <Table.Th className="whitespace-nowrap">{translate("Phone", "الهاتف")}</Table.Th>
                    <Table.Th className="whitespace-nowrap">{translate("Status", "الحالة")}</Table.Th>
                    <Table.Th className="whitespace-nowrap text-end">{translate("Projects", "المشروعات")}</Table.Th>
                    <Table.Th className="whitespace-nowrap">{translate("Updated At", "تاريخ التحديث")}</Table.Th>
                    <Table.Th className="whitespace-nowrap">{translate("Actions", "الإجراءات")}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {visible.map((manager) => {
                    const projectsCount = manager.projectsCount ?? 0;
                    const inUse = projectsCount > 0;
                    return (
                      <Table.Tr key={manager._id}>
                        <Table.Td className="font-medium">
                          <TruncatedText text={manager.name} maxWidthClassName="max-w-[220px] sm:max-w-[280px]" />
                        </Table.Td>
                        <Table.Td dir="ltr" className="text-start">
                          {manager.email || "-"}
                        </Table.Td>
                        <Table.Td dir="ltr" className="whitespace-nowrap text-start">
                          {manager.phone || "-"}
                        </Table.Td>
                        <Table.Td className="whitespace-nowrap">
                          <Badge color={manager.isActive ? "green" : "gray"} variant="light">
                            {manager.isActive ? translate("Active", "نشط") : translate("Inactive", "غير نشط")}
                          </Badge>
                        </Table.Td>
                        <Table.Td className="whitespace-nowrap text-end tabular-nums">{projectsCount}</Table.Td>
                        <Table.Td className="whitespace-nowrap">
                          {manager.updatedAt ? formatDate(manager.updatedAt, language) : "-"}
                        </Table.Td>
                        <Table.Td className="whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <Tooltip label={translate("Edit", "تعديل")}>
                              <ActionIcon
                                variant="light"
                                aria-label={translate("Edit", "تعديل")}
                                onClick={() => openEdit(manager)}
                              >
                                <outlineIcons.Edit />
                              </ActionIcon>
                            </Tooltip>
                            <Button
                              variant="light"
                              size="xs"
                              color={manager.isActive ? "orange" : "green"}
                              loading={togglingId === manager._id}
                              disabled={!!togglingId && togglingId !== manager._id}
                              onClick={() => toggleActive(manager)}
                            >
                              {manager.isActive ? translate("Deactivate", "إلغاء التفعيل") : translate("Activate", "تفعيل")}
                            </Button>
                            <Tooltip
                              label={
                                inUse
                                  ? translate(
                                      `Assigned to ${projectsCount} project(s) - cannot be deleted. Deactivate instead.`,
                                      `معين على ${projectsCount} مشروع - لا يمكن حذفه. قم بإلغاء تفعيله بدلاً من ذلك.`,
                                    )
                                  : translate("Delete", "حذف")
                              }
                              multiline
                              w={240}
                            >
                              {/* Wrapped: a disabled button fires no hover events, so the tooltip would never show. */}
                              <span className="inline-flex">
                                <ActionIcon
                                  variant="light"
                                  color="red"
                                  aria-label={translate("Delete", "حذف")}
                                  disabled={inUse}
                                  onClick={() => askDelete(manager)}
                                >
                                  <outlineIcons.Trash />
                                </ActionIcon>
                              </span>
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
        </>
      )}

      <ProjectManagerModal
        opened={formOpened}
        close={closeForm}
        manager={editing}
        onSubmit={(input) => (editing ? updateProjectManager(editing._id, input) : createProjectManager(input))}
      />

      <DeleteModal
        opened={deleteOpened}
        onClose={() => !deleteLoading && closeDelete()}
        title={translate("Delete Project Manager", "حذف مدير المشروع")}
        subTitle={translate(
          `Permanently delete the project manager "${deleting?.name ?? ""}"? This cannot be undone.`,
          `حذف مدير المشروع "${deleting?.name ?? ""}" نهائياً؟ لا يمكن التراجع عن ذلك.`,
        )}
        action={confirmDelete}
        loading={deleteLoading}
        error={deleteError}
      />
    </AdminLayoutBox>
  );
}
