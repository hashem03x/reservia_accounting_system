import { useEffect, useState } from "react";
import { useDisclosure } from "@mantine/hooks";
import { useDebounce } from "use-debounce";
import {
  ActionIcon,
  Badge,
  Button,
  Pagination,
  Select,
  Table,
  Tabs,
  TextInput,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useHasPermission from "@/hooks/useHasPermission";
import useCurrencies, { CurrencyStatusFilter } from "@/hooks/useCurrencies";
import handleRequest from "@/utils/helpers/handle-request";
import { formatDate } from "@/utils/helpers/date-formaters";
import { formatRate, inverseRate } from "@/utils/helpers/currency-math";
import resources from "@/utils/constants/resources";
import actions from "@/utils/constants/actions";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import EmptySection from "@/components/ui/sections/empty";
import DeleteModal from "@/components/ui/delete-modal";
import { DataTable, DataTableContainer, dataTableHeadClassName } from "@/components/ui/data-table";
import { outlineIcons, solidIcons } from "@/components/icons";
import { Currency } from "@/types/currency";
import CurrencyModal from "./_components/currency-modal";
import CurrencyDetailsModal from "./_components/currency-details-modal";
import WarehouseCashBalances from "./_components/warehouse-cash-balances";

type SortField = "code" | "name" | "unitsPerBase" | "updatedAt";
const PAGE_SIZE = 20;

/**
 * Accounting -> Currencies (Currency Manager). EGP is the base currency; every other currency has a
 * rate entered as "1 EGP = X units", shown with its inverse. Journal entries pick a currency here and
 * store the rate they were recorded with, so editing a rate never changes historical entries.
 * A currency used by any accounting record cannot be deleted - it is deactivated instead.
 *
 * The second tab is the original per-warehouse foreign cash page, unchanged.
 */
export default function Currencies() {
  const { language, translate, translations } = useLanguage();
  useDocumentTitle(`${translations.pages.currencies} | ${translations.adminPanel}`);

  const canCreate = useHasPermission(resources.currencies, actions.create);
  const canUpdate = useHasPermission(resources.currencies, actions.update);
  const canDelete = useHasPermission(resources.currencies, actions.delete);

  const [keyword, setKeyword] = useState("");
  const [debouncedKeyword] = useDebounce(keyword, 350);
  const [status, setStatus] = useState<CurrencyStatusFilter>("all");
  const [sortField, setSortField] = useState<SortField>("code");
  const [sortDesc, setSortDesc] = useState(false);
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [debouncedKeyword, status, sortField, sortDesc]);

  const {
    currencies,
    pagination,
    totalCount,
    loading,
    error,
    reload,
    getCurrency,
    createCurrency,
    updateCurrency,
    deleteCurrency,
  } = useCurrencies({
    keyword: debouncedKeyword,
    status,
    sort: `${sortDesc ? "-" : ""}${sortField}`,
    page,
    limit: PAGE_SIZE,
  });
  const filtersActive = !!debouncedKeyword.trim() || status !== "all";

  function toggleSort(field: SortField) {
    if (sortField === field) setSortDesc((d) => !d);
    else {
      setSortField(field);
      setSortDesc(false);
    }
  }

  // Create / edit
  const [formOpened, { open: openForm, close: closeForm }] = useDisclosure();
  const [editing, setEditing] = useState<Currency | null>(null);
  function openCreate() {
    setEditing(null);
    openForm();
  }
  function openEdit(currency: Currency) {
    setEditing(currency);
    openForm();
  }

  // Details
  const [detailsOpened, { open: openDetails, close: closeDetails }] = useDisclosure();
  const [detailsId, setDetailsId] = useState<string | null>(null);
  function showDetails(currency: Currency) {
    setDetailsId(currency._id);
    openDetails();
  }

  // Delete (unused, non-base currencies only)
  const [deleteOpened, { open: openDelete, close: closeDelete }] = useDisclosure();
  const [deleting, setDeleting] = useState<Currency | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  function askDelete(currency: Currency) {
    setDeleting(currency);
    setDeleteError("");
    openDelete();
  }
  function confirmDelete() {
    if (!deleting || deleteLoading) return;
    handleRequest(language, setDeleteLoading, setDeleteError, async () => {
      await deleteCurrency(deleting._id);
      closeDelete();
    });
  }

  // Activate / deactivate - confirmed, since a deactivated currency can no longer be picked on entries.
  const [toggleOpened, { open: openToggle, close: closeToggle }] = useDisclosure();
  const [toggling, setToggling] = useState<Currency | null>(null);
  const [toggleLoading, setToggleLoading] = useState(false);
  const [toggleError, setToggleError] = useState("");
  function askToggle(currency: Currency) {
    setToggling(currency);
    setToggleError("");
    openToggle();
  }
  function confirmToggle() {
    if (!toggling || toggleLoading) return;
    handleRequest(language, setToggleLoading, setToggleError, async () => {
      await updateCurrency(toggling._id, { isActive: !toggling.isActive, expectedVersion: toggling.__v });
      closeToggle();
    });
  }

  const SortHeader = ({ field, label, className = "" }: { field: SortField; label: string; className?: string }) => (
    <Table.Th
      className={`whitespace-nowrap ${className}`}
      aria-sort={sortField === field ? (sortDesc ? "descending" : "ascending") : "none"}
    >
      <UnstyledButton onClick={() => toggleSort(field)} className="inline-flex items-center gap-1 font-semibold">
        {label}
        <span aria-hidden className="text-xs text-gray-400">
          {sortField === field ? (sortDesc ? "▼" : "▲") : "↕"}
        </span>
      </UnstyledButton>
    </Table.Th>
  );

  const currenciesTab = (
    <>
      <div className="mb-4 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-100">
        {translate(
          "Base currency: EGP. Rates are entered as 1 EGP = X units of the foreign currency (e.g. 1 EGP = 0.02 USD means 1 USD = 50 EGP). Journal entries keep the rate they were recorded with.",
          "العملة الأساسية: الجنيه المصري. تُدخل الأسعار بصيغة 1 جنيه = X وحدة من العملة الأجنبية (مثال: 1 جنيه = 0.02 دولار يعني 1 دولار = 50 جنيه). تحتفظ القيود بالسعر الذي سُجلت به.",
        )}
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <TextInput
          placeholder={translate("Search by code or name", "ابحث بالرمز أو الاسم")}
          aria-label={translate("Search currencies", "ابحث في العملات")}
          leftSection={<solidIcons.Search />}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          className="w-full sm:w-[260px]"
        />
        <Select
          aria-label={translate("Status", "الحالة")}
          value={status}
          onChange={(v) => setStatus((v as CurrencyStatusFilter) || "all")}
          data={[
            { value: "all", label: translate("All statuses", "كل الحالات") },
            { value: "active", label: translate("Active", "نشط") },
            { value: "inactive", label: translate("Inactive", "غير نشط") },
          ]}
          allowDeselect={false}
          className="w-full sm:w-[180px]"
        />
      </div>

      {loading && currencies.length === 0 ? (
        <LoadingSection message={translate("Loading currencies...", "جاري تحميل العملات...")} />
      ) : error ? (
        <ErrorSection
          errorTitle={translate("Error loading currencies", "خطأ في تحميل العملات")}
          errorMessage={error}
          button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: reload }}
        />
      ) : currencies.length === 0 ? (
        <EmptySection
          useDefaultImg
          message={
            filtersActive
              ? translate("No currencies match your search.", "لا توجد عملات مطابقة.")
              : translate("No currencies yet. Add the first one.", "لا توجد عملات بعد. أضف أول عملة.")
          }
        />
      ) : (
        <>
          <DataTableContainer>
            <DataTable className={`min-w-[920px] ${loading ? "opacity-60" : ""}`}>
              <Table.Thead className={dataTableHeadClassName}>
                <Table.Tr>
                  <SortHeader field="code" label={translate("Code", "الرمز")} />
                  <SortHeader field="name" label={translate("Name", "الاسم")} />
                  <Table.Th className="whitespace-nowrap">{translate("Symbol", "الرمز المختصر")}</Table.Th>
                  <SortHeader field="unitsPerBase" label={translate("1 EGP =", "1 جنيه =")} className="text-right" />
                  <Table.Th className="whitespace-nowrap text-right">
                    {translate("1 unit = (EGP)", "1 وحدة = (جنيه)")}
                  </Table.Th>
                  <Table.Th className="whitespace-nowrap">{translate("Status", "الحالة")}</Table.Th>
                  <Table.Th className="whitespace-nowrap text-right">{translate("Used by", "مستخدمة في")}</Table.Th>
                  <SortHeader field="updatedAt" label={translate("Updated At", "تاريخ التحديث")} />
                  <Table.Th className="whitespace-nowrap">{translate("Actions", "الإجراءات")}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {currencies.map((currency) => {
                  const used = (currency.usageCount ?? 0) > 0;
                  const name = language === "ar-EG" && currency.nameAr ? currency.nameAr : currency.name;
                  return (
                    <Table.Tr key={currency._id}>
                      <Table.Td className="whitespace-nowrap font-semibold">
                        <div className="flex items-center gap-2">
                          {currency.code}
                          {currency.isBase && (
                            <Badge color="blue" variant="filled" size="xs">
                              {translate("Base", "أساسية")}
                            </Badge>
                          )}
                        </div>
                      </Table.Td>
                      <Table.Td>{name}</Table.Td>
                      <Table.Td>{currency.symbol || "-"}</Table.Td>
                      <Table.Td className="whitespace-nowrap text-right tabular-nums">
                        {`${formatRate(currency.unitsPerBase)} ${currency.code}`}
                      </Table.Td>
                      <Table.Td className="whitespace-nowrap text-right tabular-nums">
                        {`${formatRate(currency.basePerUnit ?? inverseRate(currency.unitsPerBase))} EGP`}
                      </Table.Td>
                      <Table.Td className="whitespace-nowrap">
                        <Badge color={currency.isActive ? "green" : "gray"} variant="light">
                          {currency.isActive ? translate("Active", "نشط") : translate("Inactive", "غير نشط")}
                        </Badge>
                      </Table.Td>
                      <Table.Td className="whitespace-nowrap text-right tabular-nums">{currency.usageCount ?? 0}</Table.Td>
                      <Table.Td className="whitespace-nowrap">
                        {currency.updatedAt ? formatDate(currency.updatedAt, language) : "-"}
                      </Table.Td>
                      <Table.Td className="whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <Tooltip label={translate("View details", "عرض التفاصيل")}>
                            <ActionIcon
                              variant="light"
                              color="gray"
                              aria-label={translate("View details", "عرض التفاصيل")}
                              onClick={() => showDetails(currency)}
                            >
                              <solidIcons.Eye />
                            </ActionIcon>
                          </Tooltip>
                          {canUpdate && (
                            <Tooltip label={translate("Edit", "تعديل")}>
                              <ActionIcon
                                variant="light"
                                aria-label={translate("Edit", "تعديل")}
                                onClick={() => openEdit(currency)}
                              >
                                <outlineIcons.Edit />
                              </ActionIcon>
                            </Tooltip>
                          )}
                          {canUpdate && !currency.isBase && (
                            <Button
                              variant="light"
                              size="xs"
                              color={currency.isActive ? "orange" : "green"}
                              onClick={() => askToggle(currency)}
                            >
                              {currency.isActive ? translate("Deactivate", "إلغاء التفعيل") : translate("Activate", "تفعيل")}
                            </Button>
                          )}
                          {canDelete && !currency.isBase && (
                            <Tooltip
                              label={
                                used
                                  ? translate(
                                      `Used by ${currency.usageCount} accounting record(s) - it cannot be deleted. Deactivate it instead.`,
                                      `مستخدمة في ${currency.usageCount} سجل محاسبي - لا يمكن حذفها. قم بإلغاء تفعيلها بدلاً من ذلك.`,
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
                                  disabled={used}
                                  onClick={() => askDelete(currency)}
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
            <span className="text-sm text-gray-500">{translate(`${totalCount} currencies`, `${totalCount} عملة`)}</span>
            {pagination.numberOfPages > 1 && (
              <Pagination total={pagination.numberOfPages} value={page} onChange={setPage} size="sm" />
            )}
          </div>
        </>
      )}
    </>
  );

  return (
    <AdminLayoutBox
      header={{
        title: translations.pages.currencies,
        subTitle: translate(
          "Manage currencies and their exchange rates against the Egyptian Pound (base currency).",
          "إدارة العملات وأسعار صرفها مقابل الجنيه المصري (العملة الأساسية).",
        ),
        sideElements: canCreate ? (
          <Button color="cyan" variant="light" onClick={openCreate} className="w-full sm:w-auto">
            {translate("Add Currency", "إضافة عملة")}
          </Button>
        ) : undefined,
      }}
    >
      <Tabs defaultValue="currencies" keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="currencies">{translate("Currencies & Rates", "العملات والأسعار")}</Tabs.Tab>
          <Tabs.Tab value="warehouses">{translate("Warehouse Cash Balances", "أرصدة نقدية الفروع")}</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="currencies">{currenciesTab}</Tabs.Panel>
        <Tabs.Panel value="warehouses">
          <WarehouseCashBalances />
        </Tabs.Panel>
      </Tabs>

      <CurrencyModal
        opened={formOpened}
        close={closeForm}
        currency={editing}
        onSubmit={(input) => (editing ? updateCurrency(editing._id, input) : createCurrency(input))}
      />

      <CurrencyDetailsModal opened={detailsOpened} close={closeDetails} currencyId={detailsId} load={getCurrency} />

      <DeleteModal
        opened={deleteOpened}
        onClose={() => !deleteLoading && closeDelete()}
        title={translate("Delete Currency", "حذف العملة")}
        subTitle={translate(
          `Permanently delete ${deleting?.code ?? ""} (${deleting?.name ?? ""})? This cannot be undone.`,
          `حذف ${deleting?.code ?? ""} (${deleting?.name ?? ""}) نهائياً؟ لا يمكن التراجع عن ذلك.`,
        )}
        action={confirmDelete}
        loading={deleteLoading}
        error={deleteError}
      />

      <DeleteModal
        opened={toggleOpened}
        onClose={() => !toggleLoading && closeToggle()}
        title={
          toggling?.isActive
            ? translate("Deactivate Currency", "إلغاء تفعيل العملة")
            : translate("Activate Currency", "تفعيل العملة")
        }
        subTitle={
          toggling?.isActive
            ? translate(
                `Deactivate ${toggling?.code ?? ""}? Existing journal entries keep it, but it can no longer be selected for new entries.`,
                `إلغاء تفعيل ${toggling?.code ?? ""}؟ تحتفظ القيود الحالية بها، لكن لا يمكن اختيارها لقيود جديدة.`,
              )
            : translate(
                `Activate ${toggling?.code ?? ""}? It will be available for new journal entries.`,
                `تفعيل ${toggling?.code ?? ""}؟ ستصبح متاحة للقيود الجديدة.`,
              )
        }
        action={confirmToggle}
        loading={toggleLoading}
        error={toggleError}
      />
    </AdminLayoutBox>
  );
}
