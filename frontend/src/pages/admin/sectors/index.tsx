import { useMemo, useState } from "react";
import { useDisclosure } from "@mantine/hooks";
import { ActionIcon, Badge, Button, Select, Table, TextInput, Tooltip } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useSectors from "@/hooks/useSectors";
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
import { Sector } from "@/types/sector";
import SectorModal from "./_components/sector-modal";

type StatusFilter = "all" | "active" | "inactive";

/**
 * Admin -> Sectors: the Project Sector options (admin-only page and API). A sector used by any
 * project cannot be deleted - it is deactivated instead, which keeps it on those projects but
 * removes it from the Project form.
 */
export default function Sectors() {
  const { language, translate, translations } = useLanguage();
  useDocumentTitle(`${translations.pages.sectors} | ${translations.adminPanel}`);

  const { sectors, loading, error, reload, createSector, updateSector, deleteSector } = useSectors();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const visibleSectors = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase();
    return sectors.filter(
      (s) =>
        (!keyword || s.name.toLocaleLowerCase().includes(keyword)) &&
        (statusFilter === "all" || (statusFilter === "active") === s.isActive),
    );
  }, [sectors, search, statusFilter]);

  // Create / edit
  const [formOpened, { open: openForm, close: closeForm }] = useDisclosure();
  const [editing, setEditing] = useState<Sector | null>(null);
  function openCreate() {
    setEditing(null);
    openForm();
  }
  function openEdit(sector: Sector) {
    setEditing(sector);
    openForm();
  }

  // Delete (unused sectors only)
  const [deleteOpened, { open: openDelete, close: closeDelete }] = useDisclosure();
  const [deleting, setDeleting] = useState<Sector | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  function askDelete(sector: Sector) {
    setDeleting(sector);
    setDeleteError("");
    openDelete();
  }
  function confirmDelete() {
    if (!deleting || deleteLoading) return;
    handleRequest(language, setDeleteLoading, setDeleteError, async () => {
      await deleteSector(deleting._id);
      closeDelete();
    });
  }

  // Activate / deactivate (row action) - per-row loading, errors shown inline above the table.
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState("");
  function toggleActive(sector: Sector) {
    if (togglingId) return;
    handleRequest(
      language,
      (isLoading) => setTogglingId(isLoading ? sector._id : null),
      setToggleError,
      async () => {
        await updateSector(sector._id, { isActive: !sector.isActive });
      },
    );
  }

  return (
    <AdminLayoutBox
      header={{
        title: translations.pages.sectors,
        sideElements: (
          <Button color="cyan" variant="light" onClick={openCreate} className="w-full sm:w-auto">
            {translate("Create Sector", "إنشاء قطاع")}
          </Button>
        ),
      }}
    >
      {loading ? (
        <LoadingSection message={translate("Loading sectors...", "جاري تحميل القطاعات...")} />
      ) : error ? (
        <ErrorSection
          errorTitle={translate("Error loading sectors", "خطأ في تحميل القطاعات")}
          errorMessage={error}
          button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: reload }}
        />
      ) : sectors.length === 0 ? (
        <EmptySection useDefaultImg message={translate("No sectors yet. Create the first one.", "لا توجد قطاعات بعد. أنشئ أول قطاع.")} />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            <TextInput
              placeholder={translate("Search by name", "ابحث بالاسم")}
              leftSection={<solidIcons.Search />}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full sm:w-[260px]"
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

          {visibleSectors.length === 0 ? (
            <EmptySection useDefaultImg message={translate("No sectors match your search.", "لا توجد قطاعات مطابقة.")} />
          ) : (
            <DataTableContainer>
              <DataTable className="min-w-[760px]">
                <Table.Thead className={dataTableHeadClassName}>
                  <Table.Tr>
                    <Table.Th>{translate("Name", "الاسم")}</Table.Th>
                    <Table.Th className="whitespace-nowrap">{translate("Status", "الحالة")}</Table.Th>
                    <Table.Th className="whitespace-nowrap text-right">{translate("Projects", "المشاريع")}</Table.Th>
                    <Table.Th className="whitespace-nowrap">{translate("Created At", "تاريخ الإنشاء")}</Table.Th>
                    <Table.Th className="whitespace-nowrap">{translate("Updated At", "تاريخ التحديث")}</Table.Th>
                    <Table.Th className="whitespace-nowrap">{translate("Actions", "الإجراءات")}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {visibleSectors.map((sector) => {
                    const projectsCount = sector.projectsCount ?? 0;
                    const inUse = projectsCount > 0;
                    return (
                      <Table.Tr key={sector._id}>
                        <Table.Td className="font-medium">
                          <TruncatedText text={sector.name} maxWidthClassName="max-w-[220px] sm:max-w-[320px]" />
                        </Table.Td>
                        <Table.Td className="whitespace-nowrap">
                          <Badge color={sector.isActive ? "green" : "gray"} variant="light">
                            {sector.isActive ? translate("Active", "نشط") : translate("Inactive", "غير نشط")}
                          </Badge>
                        </Table.Td>
                        <Table.Td className="whitespace-nowrap text-right tabular-nums">{projectsCount}</Table.Td>
                        <Table.Td className="whitespace-nowrap">{sector.createdAt ? formatDate(sector.createdAt, language) : "-"}</Table.Td>
                        <Table.Td className="whitespace-nowrap">{sector.updatedAt ? formatDate(sector.updatedAt, language) : "-"}</Table.Td>
                        <Table.Td className="whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <Tooltip label={translate("Edit", "تعديل")}>
                              <ActionIcon variant="light" aria-label={translate("Edit", "تعديل")} onClick={() => openEdit(sector)}>
                                <outlineIcons.Edit />
                              </ActionIcon>
                            </Tooltip>
                            <Button
                              variant="light"
                              size="xs"
                              color={sector.isActive ? "orange" : "green"}
                              loading={togglingId === sector._id}
                              disabled={!!togglingId && togglingId !== sector._id}
                              onClick={() => toggleActive(sector)}
                            >
                              {sector.isActive ? translate("Deactivate", "إلغاء التفعيل") : translate("Activate", "تفعيل")}
                            </Button>
                            <Tooltip
                              label={
                                inUse
                                  ? translate(
                                      `Used by ${projectsCount} project(s) - it cannot be deleted. Deactivate it instead.`,
                                      `مستخدم في ${projectsCount} مشروع - لا يمكن حذفه. قم بإلغاء تفعيله بدلاً من ذلك.`,
                                    )
                                  : translate("Delete", "حذف")
                              }
                              multiline
                              w={240}
                            >
                              {/* Wrapped: a disabled button fires no hover events, so the tooltip
                                  explaining why it is disabled would never show. */}
                              <span className="inline-flex">
                                <ActionIcon
                                  variant="light"
                                  color="red"
                                  aria-label={translate("Delete", "حذف")}
                                  disabled={inUse}
                                  onClick={() => askDelete(sector)}
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

      <SectorModal
        opened={formOpened}
        close={closeForm}
        sector={editing}
        onSubmit={(input) => (editing ? updateSector(editing._id, input) : createSector(input))}
      />

      <DeleteModal
        opened={deleteOpened}
        onClose={() => !deleteLoading && closeDelete()}
        title={translate("Delete Sector", "حذف القطاع")}
        subTitle={translate(
          `Permanently delete the sector "${deleting?.name ?? ""}"? This cannot be undone.`,
          `حذف القطاع "${deleting?.name ?? ""}" نهائياً؟ لا يمكن التراجع عن ذلك.`,
        )}
        action={confirmDelete}
        loading={deleteLoading}
        error={deleteError}
      />
    </AdminLayoutBox>
  );
}
