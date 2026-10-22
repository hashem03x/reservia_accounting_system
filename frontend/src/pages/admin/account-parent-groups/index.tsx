import { useEffect, useState } from "react";
import { useDisclosure } from "@mantine/hooks";
import { useDebounce } from "use-debounce";
import { ActionIcon, Badge, Button, Pagination, Select, Table, TextInput, Tooltip, UnstyledButton } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useHasPermission from "@/hooks/useHasPermission";
import useAccountParentGroups, { ParentGroupStatusFilter } from "@/hooks/useAccountParentGroups";
import handleRequest from "@/utils/helpers/handle-request";
import { ACCOUNT_TYPES, accountTypeLabel } from "@/utils/helpers/account-parent-groups";
import resources from "@/utils/constants/resources";
import actions from "@/utils/constants/actions";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import EmptySection from "@/components/ui/sections/empty";
import DeleteModal from "@/components/ui/delete-modal";
import { DataTable, DataTableContainer, dataTableHeadClassName } from "@/components/ui/data-table";
import { outlineIcons, solidIcons } from "@/components/icons";
import { AccountParentGroup } from "@/types/account-parent-group";
import ParentGroupModal from "./_components/parent-group-modal";

type SortField = "sortOrder" | "nameEn" | "nameAr" | "type" | "accountCount";
const PAGE_SIZE = 20;

/**
 * Accounting -> Parent Account Groups. The managed list of classifications (e.g. "Cash & Cash
 * Equivalents") a Chart of Accounts account can be placed in - stored on each account as
 * parentGroupNameEn / parentGroupNameAr. Groups are not posting accounts: nothing here creates a
 * journal entry or changes a balance. A group assigned to accounts cannot be deleted (deactivate it
 * instead); system-default groups, which automatic accounting rules read, are protected.
 * Governed by the Chart of Accounts (`accounts`) permission.
 */
export default function AccountParentGroups() {
  const { language, translate, translations } = useLanguage();
  useDocumentTitle(`${translations.pages.accountParentGroups} | ${translations.adminPanel}`);
  const isArabic = language === "ar-EG";

  const canCreate = useHasPermission(resources.accounts, actions.create);
  const canUpdate = useHasPermission(resources.accounts, actions.update);
  const canDelete = useHasPermission(resources.accounts, actions.delete);

  const [keyword, setKeyword] = useState("");
  const [debouncedKeyword] = useDebounce(keyword, 350);
  const [status, setStatus] = useState<ParentGroupStatusFilter>("all");
  const [type, setType] = useState("");
  const [sortField, setSortField] = useState<SortField>("sortOrder");
  const [sortDesc, setSortDesc] = useState(false);
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [debouncedKeyword, status, type, sortField, sortDesc]);

  const { groups, pagination, totalCount, loading, error, reload, createGroup, updateGroup, setGroupStatus, deleteGroup } = useAccountParentGroups({
    keyword: debouncedKeyword,
    status,
    type,
    sort: `${sortDesc ? "-" : ""}${sortField}`,
    page,
    limit: PAGE_SIZE,
  });
  const filtersActive = !!debouncedKeyword.trim() || status !== "all" || !!type;

  function toggleSort(field: SortField) {
    if (sortField === field) setSortDesc((d) => !d);
    else {
      setSortField(field);
      setSortDesc(false);
    }
  }

  // Create / edit
  const [formOpened, { open: openForm, close: closeForm }] = useDisclosure();
  const [editing, setEditing] = useState<AccountParentGroup | null>(null);
  function openCreate() {
    setEditing(null);
    openForm();
  }
  function openEdit(group: AccountParentGroup) {
    setEditing(group);
    openForm();
  }

  // Delete (unused, non-system-default groups only)
  const [deleteOpened, { open: openDelete, close: closeDelete }] = useDisclosure();
  const [deleting, setDeleting] = useState<AccountParentGroup | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  function askDelete(group: AccountParentGroup) {
    setDeleting(group);
    setDeleteError("");
    openDelete();
  }
  function confirmDelete() {
    if (!deleting || deleteLoading) return;
    handleRequest(language, setDeleteLoading, setDeleteError, async () => {
      await deleteGroup(deleting._id);
      closeDelete();
    });
  }

  // Activate / deactivate - confirmed, since a deactivated group is no longer offered for new accounts.
  const [toggleOpened, { open: openToggle, close: closeToggle }] = useDisclosure();
  const [toggling, setToggling] = useState<AccountParentGroup | null>(null);
  const [toggleLoading, setToggleLoading] = useState(false);
  const [toggleError, setToggleError] = useState("");
  function askToggle(group: AccountParentGroup) {
    setToggling(group);
    setToggleError("");
    openToggle();
  }
  function confirmToggle() {
    if (!toggling || toggleLoading) return;
    handleRequest(language, setToggleLoading, setToggleError, async () => {
      await setGroupStatus(toggling._id, !toggling.isActive);
      closeToggle();
    });
  }

  const SortHeader = ({ field, label, className = "" }: { field: SortField; label: string; className?: string }) => (
    <Table.Th className={`whitespace-nowrap ${className}`} aria-sort={sortField === field ? (sortDesc ? "descending" : "ascending") : "none"}>
      <UnstyledButton onClick={() => toggleSort(field)} className="inline-flex items-center gap-1 font-semibold">
        {label}
        <span aria-hidden className="text-xs text-gray-400">
          {sortField === field ? (sortDesc ? "▼" : "▲") : "↕"}
        </span>
      </UnstyledButton>
    </Table.Th>
  );

  const nameOf = (group: AccountParentGroup | null) => (group ? (isArabic ? group.nameAr : group.nameEn) : "");

  return (
    <AdminLayoutBox
      header={{
        title: translations.pages.accountParentGroups,
        subTitle: translate(
          "Classifications such as Cash & Cash Equivalents that Chart of Accounts entries are grouped under. Groups are not posting accounts.",
          "تصنيفات مثل النقدية وما في حكمها تُجمع تحتها حسابات دليل الحسابات. المجموعات ليست حسابات ترحيل.",
        ),
        sideElements: canCreate ? (
          <Button color="cyan" variant="light" onClick={openCreate} className="w-full sm:w-auto">
            {translate("Add Parent Group", "إضافة مجموعة")}
          </Button>
        ) : undefined,
      }}
    >
      <div className="mb-4 flex flex-wrap gap-2">
        <TextInput
          placeholder={translate("Search by English or Arabic name", "ابحث بالاسم الإنجليزي أو العربي")}
          aria-label={translate("Search parent groups", "ابحث في المجموعات")}
          leftSection={<solidIcons.Search />}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          className="w-full sm:w-[280px]"
        />
        <Select
          aria-label={translate("Account Type", "نوع الحساب")}
          placeholder={translate("All types", "كل الأنواع")}
          value={type || null}
          onChange={(v) => setType(v || "")}
          data={ACCOUNT_TYPES.map((t) => ({ value: t, label: accountTypeLabel(t, translate) }))}
          clearable
          className="w-full sm:w-[180px]"
        />
        <Select
          aria-label={translate("Status", "الحالة")}
          value={status}
          onChange={(v) => setStatus((v as ParentGroupStatusFilter) || "all")}
          data={[
            { value: "all", label: translate("All statuses", "كل الحالات") },
            { value: "active", label: translate("Active", "نشط") },
            { value: "inactive", label: translate("Inactive", "غير نشط") },
          ]}
          allowDeselect={false}
          className="w-full sm:w-[180px]"
        />
      </div>

      {loading && groups.length === 0 ? (
        <LoadingSection message={translate("Loading parent groups...", "جاري تحميل المجموعات...")} />
      ) : error ? (
        <ErrorSection
          errorTitle={translate("Error loading parent groups", "خطأ في تحميل المجموعات")}
          errorMessage={error}
          button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: reload }}
        />
      ) : groups.length === 0 ? (
        <EmptySection
          useDefaultImg
          message={
            filtersActive
              ? translate("No parent groups match your filters.", "لا توجد مجموعات مطابقة.")
              : translate("No parent groups yet. Add the first one.", "لا توجد مجموعات بعد. أضف أول مجموعة.")
          }
        />
      ) : (
        <>
          <DataTableContainer>
            <DataTable className={`min-w-[900px] ${loading ? "opacity-60" : ""}`}>
              <Table.Thead className={dataTableHeadClassName}>
                <Table.Tr>
                  <SortHeader field="nameEn" label={translate("English Name", "الاسم الإنجليزي")} />
                  <SortHeader field="nameAr" label={translate("Arabic Name", "الاسم العربي")} />
                  <SortHeader field="type" label={translate("Account Type", "نوع الحساب")} />
                  <SortHeader field="sortOrder" label={translate("Order", "الترتيب")} className="text-right" />
                  <SortHeader field="accountCount" label={translate("Accounts", "الحسابات")} className="text-right" />
                  <Table.Th className="whitespace-nowrap">{translate("Status", "الحالة")}</Table.Th>
                  <Table.Th className="whitespace-nowrap">{translate("Actions", "الإجراءات")}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {groups.map((group) => {
                  const used = (group.accountCount ?? 0) > 0;
                  return (
                    <Table.Tr key={group._id}>
                      <Table.Td>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold">{group.nameEn}</span>
                          {group.isSystemDefault && (
                            <Tooltip
                              label={translate("Used by automatic accounting rules - protected", "تستخدمها القواعد المحاسبية الآلية - محمية")}
                              multiline
                              w={220}
                            >
                              <Badge color="blue" variant="filled" size="xs">
                                {translate("System", "النظام")}
                              </Badge>
                            </Tooltip>
                          )}
                        </div>
                        {group.description && <div className="text-xs text-gray-500">{group.description}</div>}
                      </Table.Td>
                      <Table.Td dir="rtl" className="text-right">
                        {group.nameAr}
                      </Table.Td>
                      <Table.Td className="whitespace-nowrap">{accountTypeLabel(group.type, translate)}</Table.Td>
                      <Table.Td className="whitespace-nowrap text-right tabular-nums">{group.sortOrder}</Table.Td>
                      <Table.Td className="whitespace-nowrap text-right tabular-nums">{group.accountCount ?? 0}</Table.Td>
                      <Table.Td className="whitespace-nowrap">
                        <Badge color={group.isActive ? "green" : "gray"} variant="light">
                          {group.isActive ? translate("Active", "نشط") : translate("Inactive", "غير نشط")}
                        </Badge>
                      </Table.Td>
                      <Table.Td className="whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          {canUpdate && (
                            <Tooltip label={translate("Edit", "تعديل")}>
                              <ActionIcon variant="light" aria-label={`${translate("Edit", "تعديل")} ${nameOf(group)}`} onClick={() => openEdit(group)}>
                                <outlineIcons.Edit />
                              </ActionIcon>
                            </Tooltip>
                          )}
                          {canUpdate && !group.isSystemDefault && (
                            <Button variant="light" size="xs" color={group.isActive ? "orange" : "green"} onClick={() => askToggle(group)}>
                              {group.isActive ? translate("Deactivate", "إلغاء التفعيل") : translate("Activate", "تفعيل")}
                            </Button>
                          )}
                          {canDelete && !group.isSystemDefault && (
                            <Tooltip
                              label={
                                used
                                  ? translate(
                                      `Assigned to ${group.accountCount} account(s) - it cannot be deleted. Deactivate it instead.`,
                                      `مستخدمة في ${group.accountCount} حساب - لا يمكن حذفها. قم بإلغاء تفعيلها بدلاً من ذلك.`,
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
                                  aria-label={`${translate("Delete", "حذف")} ${nameOf(group)}`}
                                  disabled={used}
                                  onClick={() => askDelete(group)}
                                >
                                  <outlineIcons.Trash />
                                </ActionIcon>
                              </span>
                            </Tooltip>
                          )}
                        </div>
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </DataTable>
          </DataTableContainer>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm text-gray-500">{translate(`${totalCount} parent groups`, `${totalCount} مجموعة`)}</span>
            {pagination.numberOfPages > 1 && <Pagination total={pagination.numberOfPages} value={page} onChange={setPage} size="sm" />}
          </div>
        </>
      )}

      <ParentGroupModal
        opened={formOpened}
        close={closeForm}
        group={editing}
        canChangeStatus={canUpdate}
        onSubmit={(input) => (editing ? updateGroup(editing._id, input) : createGroup(input))}
      />

      <DeleteModal
        opened={deleteOpened}
        onClose={() => !deleteLoading && closeDelete()}
        title={translate("Delete Parent Group", "حذف المجموعة")}
        subTitle={translate(
          `Permanently delete "${deleting?.nameEn ?? ""}"? This cannot be undone.`,
          `حذف "${deleting?.nameAr ?? ""}" نهائياً؟ لا يمكن التراجع عن ذلك.`,
        )}
        action={confirmDelete}
        loading={deleteLoading}
        error={deleteError}
      />

      <DeleteModal
        opened={toggleOpened}
        onClose={() => !toggleLoading && closeToggle()}
        title={toggling?.isActive ? translate("Deactivate Parent Group", "إلغاء تفعيل المجموعة") : translate("Activate Parent Group", "تفعيل المجموعة")}
        subTitle={
          toggling?.isActive
            ? translate(
                `Deactivate "${toggling?.nameEn ?? ""}"? Accounts already in it keep it, but it can no longer be chosen for accounts.`,
                `إلغاء تفعيل "${toggling?.nameAr ?? ""}"؟ تحتفظ الحسابات الحالية بها، لكن لا يمكن اختيارها للحسابات.`,
              )
            : translate(
                `Activate "${toggling?.nameEn ?? ""}"? It will be offered in the Chart of Accounts form again.`,
                `تفعيل "${toggling?.nameAr ?? ""}"؟ ستُعرض مرة أخرى في نموذج دليل الحسابات.`,
              )
        }
        action={confirmToggle}
        loading={toggleLoading}
        error={toggleError}
      />
    </AdminLayoutBox>
  );
}
