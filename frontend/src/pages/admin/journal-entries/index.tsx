import { JournalEntry } from "@/types/journal-entry";
import { PaginatedData } from "@/types/global";
import { useEffect, useState } from "react";
import { useDisclosure } from "@mantine/hooks";
import { useDebounce } from "use-debounce";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import useHasPermission from "@/hooks/useHasPermission";
import useHandlePreviousFilters from "@/hooks/useHandlePreviousFilters";
import handleRequest from "@/utils/helpers/handle-request";
import { formatRate } from "@/utils/helpers/currency-math";
import { formatDate } from "@/utils/helpers/date-formaters";
import { DEFAULT_ITEMS_PER_PAGE } from "@/utils/constants";
import resources from "@/utils/constants/resources";
import actions from "@/utils/constants/actions";
import { Badge, Button, Select, Table, TextInput } from "@mantine/core";
import { DateInput } from "@mantine/dates";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import EmptySection from "@/components/ui/sections/empty";
import NoResultsSection from "@/components/ui/sections/no-results";
import PaginationHandler from "@/components/ui/pagination-handler";
import { DataTable, DataTableContainer, dataTableHeadClassName } from "@/components/ui/data-table";
import { ClickableRow } from "@/components/ui/clickable-row";
import { solidIcons, outlineIcons } from "@/components/icons";
import { displayModuleLabel, entryClassification, entryClassificationLabel } from "@/utils/helpers/accounting-labels";
import CreateJournalEntryModal from "./_components/create-journal-entry-modal";

const ITEMS_PER_PAGE = import.meta.env.VITE_ITEMS_PER_PAGE || DEFAULT_ITEMS_PER_PAGE;

const statusColors: Record<string, string> = { draft: "yellow", posted: "green", reversed: "gray" };

// Columns whose server-side sort the backend whitelists (journalEntryController.js#SORTABLE_FIELDS)
// - must stay in sync with that list; sorting by anything else silently falls back to entryNumber.
type SortField = "entryNumber" | "date" | "totalDebit" | "totalCredit";

export default function JournalEntries() {
  const { language, translate, translations } = useLanguage();
  const navigate = useNavigate();
  const canCreate = useHasPermission(resources.journalEntries, actions.create);

  useDocumentTitle(`${translations.pages.journalEntries} | ${translations.adminPanel}`);

  const [searchParams, setSearchParams] = useSearchParams();
  const [activePage, setActivePage] = useState(parseInt(searchParams.get("page") || "1"));

  const [showFilters, setShowFilters] = useState(false);
  const [entryNumber, setEntryNumber] = useState(searchParams.get("entryNumber") || "");
  const [dateFrom, setDateFrom] = useState<Date | null>(
    searchParams.get("dateFrom") ? new Date(searchParams.get("dateFrom") as string) : null,
  );
  const [dateTo, setDateTo] = useState<Date | null>(
    searchParams.get("dateTo") ? new Date(searchParams.get("dateTo") as string) : null,
  );
  const [accountNumber, setAccountNumber] = useState(searchParams.get("accountNumber") || "");
  const [accountName, setAccountName] = useState(searchParams.get("accountName") || "");
  const [subAccount, setSubAccount] = useState(searchParams.get("subAccount") || "");
  const [projectNumber, setProjectNumber] = useState(searchParams.get("projectNumber") || "");
  const [description, setDescription] = useState(searchParams.get("description") || "");
  const [status, setStatus] = useState(searchParams.get("status") || "");
  const [classification, setClassification] = useState(searchParams.get("classification") || "");
  const [currency, setCurrency] = useState(searchParams.get("currency") || "");
  const [moduleFilter, setModuleFilter] = useState(searchParams.get("module") || "");

  const [debouncedAccountNumber] = useDebounce(accountNumber, 350);
  const [debouncedAccountName] = useDebounce(accountName, 350);
  const [debouncedSubAccount] = useDebounce(subAccount, 350);
  const [debouncedProjectNumber] = useDebounce(projectNumber, 350);
  const [debouncedDescription] = useDebounce(description, 350);
  const [debouncedEntryNumber] = useDebounce(entryNumber, 350);
  const [debouncedCurrency] = useDebounce(currency, 350);

  const [sort, setSort] = useState(searchParams.get("sort") || "entryNumber");
  const sortOptions = [
    { value: "entryNumber", label: translate("Entry number: old to new", "رقم القيد: من الأقدم للأحدث") },
    { value: "-entryNumber", label: translate("Entry number: new to old", "رقم القيد: من الأحدث للأقدم") },
    { value: "date", label: translate("Date: old to new", "التاريخ: من الأقدم للأحدث") },
    { value: "-date", label: translate("Date: new to old", "التاريخ: من الأحدث للأقدم") },
  ];
  const moduleOptions = ["Manual", "Sales Order", "Purchase Order", "Payment", "Advanced Payment", "Project", "Expense", "Fixed Asset", "Equity", "Inventory"].map(
    (m) => ({ value: m, label: displayModuleLabel(m, translate) }),
  );
  const classificationOptions = (["project", "ga", "unclassified"] as const).map((key) => ({ value: key, label: entryClassificationLabel(key, translate) }));
  const statusOptions = [
    { value: "draft", label: translate("Draft", "مسودة") },
    { value: "posted", label: translate("Posted", "مرحّل") },
    { value: "reversed", label: translate("Reversed", "ملغى") },
  ];

  function toggleSort(field: SortField) {
    setSort((prev) => (prev === field ? `-${field}` : field));
  }
  function sortIndicator(field: SortField) {
    if (sort === field) return <solidIcons.ArrowUp size={12} className="inline" />;
    if (sort === `-${field}`) return <solidIcons.ArrowDown size={12} className="inline" />;
    return null;
  }

  const filterParams = {
    ...(debouncedEntryNumber ? { entryNumber: debouncedEntryNumber } : {}),
    ...(dateFrom ? { dateFrom: dateFrom.toISOString().slice(0, 10) } : {}),
    ...(dateTo ? { dateTo: dateTo.toISOString().slice(0, 10) } : {}),
    ...(debouncedAccountNumber ? { accountNumber: debouncedAccountNumber } : {}),
    ...(debouncedAccountName ? { accountName: debouncedAccountName } : {}),
    ...(debouncedSubAccount ? { subAccount: debouncedSubAccount } : {}),
    ...(debouncedProjectNumber ? { projectNumber: debouncedProjectNumber } : {}),
    ...(debouncedDescription ? { description: debouncedDescription } : {}),
    ...(status ? { status } : {}),
    ...(classification ? { classification } : {}),
    ...(debouncedCurrency.trim() ? { currency: debouncedCurrency.trim() } : {}),
    ...(moduleFilter ? { module: moduleFilter } : {}),
  };
  const params = { page: activePage.toString(), sort, ...filterParams };

  const hasActiveFilters = Object.keys(filterParams).length > 0;

  function clearFilters() {
    setEntryNumber("");
    setDateFrom(null);
    setDateTo(null);
    setAccountNumber("");
    setAccountName("");
    setSubAccount("");
    setProjectNumber("");
    setDescription("");
    setStatus("");
    setClassification("");
    setCurrency("");
    setModuleFilter("");
  }

  const { filtersChanged, updatePreviousFilters } = useHandlePreviousFilters(filterParams);

  // One row per Journal Entry DOCUMENT (never per line) - `JournalEntry.lines[]` is already the
  // "one entry, many lines" grouping structure (docs section "Grouping Key" - prefer the real
  // document id, never date/module/project/description/account). Plain `GET journal-entries`
  // (not `general-ledger`, which is the flattened per-LINE General Ledger view used by a different
  // page) - each row already carries its own server-derived currency/rate/difference (see
  // journalEntryController.js#withEntryListFields), never computed here in React.
  const {
    privateRequest,
    loading,
    setLoading,
    error,
    setError,
    data: paginatedEntries,
    setData: setPaginatedEntries,
  } = useDataHandler<PaginatedData<JournalEntry>>({ initialData: null, initialLoading: true });

  function handleLoadEntries() {
    const controller = new AbortController();
    const canceled = { current: false };

    const executeFetch = async () => {
      const response = await privateRequest({
        url: "journal-entries",
        params: { limit: ITEMS_PER_PAGE, ...params },
        signal: controller.signal,
        language,
      });
      setPaginatedEntries(response);
    };

    handleRequest(language, setLoading, setError, executeFetch, canceled);

    return () => {
      controller.abort();
      canceled.current = true;
    };
  }

  useEffect(() => {
    setSearchParams(params, { replace: true });

    if (filtersChanged(filterParams)) {
      updatePreviousFilters(filterParams);
      if (activePage !== 1) {
        setActivePage(1);
        return;
      }
    }

    window.scrollTo({ top: 0, behavior: "instant" });
    const cancelRequest = handleLoadEntries();
    return cancelRequest;
  }, [
    activePage,
    sort,
    debouncedEntryNumber,
    dateFrom,
    dateTo,
    debouncedAccountNumber,
    debouncedAccountName,
    debouncedSubAccount,
    debouncedProjectNumber,
    debouncedDescription,
    status,
    classification,
    debouncedCurrency,
    moduleFilter,
  ]);

  const [createModalOpened, { open: openCreateModal, close: closeCreateModal }] = useDisclosure();

  return (
    <AdminLayoutBox
      header={{
        title: translations.pages.journalEntries,
        sideElements: canCreate && (
          <Button color="cyan" variant="light" onClick={openCreateModal}>
            {translate("Create Journal Entry", "إنشاء قيد يومية")}
          </Button>
        ),
      }}
    >
      <div className="flex items-center justify-between gap-2">
        {hasActiveFilters && (
          <Button
            color="red"
            variant="light"
            onClick={clearFilters}
            title={translate("Clear All Filters", "مسح جميع الفلاتر")}
          >
            <outlineIcons.Trash />
          </Button>
        )}
        {/* Explicit oldest/newest order - the same server-side sort the column headers toggle, so it
            always orders the WHOLE result set, never just the loaded page. */}
        <Select
          className="ms-auto w-[230px]"
          aria-label={translate("Sort order", "ترتيب العرض")}
          value={sortOptions.some((o) => o.value === sort) ? sort : null}
          placeholder={translate("Custom column sort", "ترتيب حسب عمود")}
          onChange={(v) => v && setSort(v)}
          data={sortOptions}
          allowDeselect={false}
        />
        <div className="relative">
          <Button variant="light" onClick={() => setShowFilters(!showFilters)}>
            <solidIcons.Filter className="me-1" />
            {translate("Filters", "الفلاتر")}
          </Button>
          {hasActiveFilters && (
            <span
              className={`absolute -top-[6px] ${translate("-right-[6px]", "-left-[6px]")} h-[15px] w-[15px] rounded-full bg-blue-500`}
            />
          )}
        </div>
      </div>

      {showFilters && (
        <div className="grid grid-cols-1 gap-2 rounded-lg border border-gray-200 p-3 dark:border-gray-700 sm:grid-cols-2 lg:grid-cols-4">
          <TextInput
            label={translate("Entry Number", "رقم القيد")}
            value={entryNumber}
            onChange={(e) => setEntryNumber(e.currentTarget.value)}
          />
          <DateInput label={translate("Date From", "من تاريخ")} value={dateFrom} onChange={setDateFrom} clearable />
          <DateInput label={translate("Date To", "إلى تاريخ")} value={dateTo} onChange={setDateTo} clearable />
          <Select
            label={translate("Status", "الحالة")}
            value={status || null}
            onChange={(v) => setStatus(v || "")}
            data={statusOptions}
            clearable
          />
          <Select
            label={translate("Project / G&A", "مشروع / عمومية")}
            value={classification || null}
            onChange={(v) => setClassification(v || "")}
            data={classificationOptions}
            clearable
          />
          <TextInput
            label={translate("Account Number", "رقم الحساب")}
            value={accountNumber}
            onChange={(e) => setAccountNumber(e.currentTarget.value)}
          />
          <TextInput
            label={translate("Account Name", "اسم الحساب")}
            value={accountName}
            onChange={(e) => setAccountName(e.currentTarget.value)}
          />
          <TextInput
            label={translate("Sub Account / Party Number", "الحساب الفرعي / رقم العميل")}
            value={subAccount}
            onChange={(e) => setSubAccount(e.currentTarget.value)}
          />
          <TextInput
            label={translate("Project Number", "رقم المشروع")}
            placeholder={translate('Type "general" for no-project entries', 'اكتب "general" للقيود بدون مشروع')}
            value={projectNumber}
            onChange={(e) => setProjectNumber(e.currentTarget.value)}
          />
          <TextInput
            label={translate("Description", "الوصف")}
            value={description}
            onChange={(e) => setDescription(e.currentTarget.value)}
            className="sm:col-span-2"
          />
        </div>
      )}

      <hr />

      {loading ? (
        <LoadingSection message={translate("Loading journal entries...", "جاري تحميل القيود...")} />
      ) : error ? (
        <ErrorSection
          errorTitle={translate("Error loading journal entries", "خطأ في تحميل القيود")}
          errorMessage={error}
          button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: handleLoadEntries }}
        />
      ) : (
        paginatedEntries &&
        (paginatedEntries.data.length === 0 ? (
          hasActiveFilters ? (
            <NoResultsSection
              keyword={description || entryNumber || accountName || accountNumber || projectNumber || ""}
              useDefaultImg
              button={{ text: translate("Clear Filters", "مسح الفلاتر"), onClick: clearFilters }}
            />
          ) : (
            <EmptySection useDefaultImg message={translate("No journal entries found", "لا توجد قيود يومية")} />
          )
        ) : (
          <>
            {/* Shared table visual system (see components/ui/data-table.tsx), first established on
                the Chart of Accounts table. Columns below are this page's own - only the
                container/header/row presentation is shared. */}
            <DataTableContainer>
              <DataTable className="min-w-[1320px]">
                <Table.Thead className={dataTableHeadClassName}>
                  <Table.Tr>
                    <Table.Th className="cursor-pointer whitespace-nowrap" onClick={() => toggleSort("date")}>
                      {translate("Document Date", "تاريخ المستند")} {sortIndicator("date")}
                    </Table.Th>
                    <Table.Th className="cursor-pointer whitespace-nowrap" onClick={() => toggleSort("entryNumber")}>
                      {translate("Document Number", "رقم المستند")} {sortIndicator("entryNumber")}
                    </Table.Th>
                    <Table.Th className="whitespace-nowrap">{translate("Module", "الوحدة")}</Table.Th>
                    <Table.Th className="whitespace-nowrap">{translate("Project / G&A", "مشروع / عمومية")}</Table.Th>
                    <Table.Th className="whitespace-nowrap">{translate("Project Number", "رقم المشروع")}</Table.Th>
                    <Table.Th className="whitespace-nowrap">{translate("Currency", "العملة")}</Table.Th>
                    <Table.Th className="whitespace-nowrap text-right">
                      {translate("Rate (EGP per unit)", "السعر (جنيه لكل وحدة)")}
                    </Table.Th>
                    <Table.Th
                      className="cursor-pointer whitespace-nowrap text-right"
                      onClick={() => toggleSort("totalDebit")}
                    >
                      {translate("Total Debit", "إجمالي المدين")} {sortIndicator("totalDebit")}
                    </Table.Th>
                    <Table.Th
                      className="cursor-pointer whitespace-nowrap text-right"
                      onClick={() => toggleSort("totalCredit")}
                    >
                      {translate("Total Credit", "إجمالي الدائن")} {sortIndicator("totalCredit")}
                    </Table.Th>
                    <Table.Th className="whitespace-nowrap text-right">{translate("Balance", "الرصيد")}</Table.Th>
                    <Table.Th>{translate("Description", "الوصف")}</Table.Th>
                    <Table.Th className="whitespace-nowrap">{translate("Status", "الحالة")}</Table.Th>
                  </Table.Tr>
                  {/* Column filters, in the header itself - the same state as the Filters panel, so both
                      always agree, and every filter runs on the server across all pages. */}
                  <Table.Tr className="align-top">
                    <Table.Th className="font-normal">
                      <DateInput size="xs" placeholder={translate("From", "من")} aria-label={translate("Date From", "من تاريخ")} value={dateFrom} onChange={setDateFrom} clearable valueFormat="YYYY-MM-DD" />
                    </Table.Th>
                    <Table.Th className="font-normal">
                      <TextInput size="xs" placeholder="#" aria-label={translate("Entry Number", "رقم القيد")} value={entryNumber} onChange={(e) => setEntryNumber(e.currentTarget.value)} />
                    </Table.Th>
                    <Table.Th className="font-normal">
                      <Select size="xs" aria-label={translate("Module", "الوحدة")} placeholder={translate("All", "الكل")} value={moduleFilter || null} onChange={(v) => setModuleFilter(v || "")} data={moduleOptions} clearable comboboxProps={{ withinPortal: true }} />
                    </Table.Th>
                    <Table.Th className="font-normal">
                      <Select size="xs" aria-label={translate("Project / G&A", "مشروع / عمومية")} placeholder={translate("All", "الكل")} value={classification || null} onChange={(v) => setClassification(v || "")} data={classificationOptions} clearable comboboxProps={{ withinPortal: true }} />
                    </Table.Th>
                    <Table.Th className="font-normal">
                      <TextInput size="xs" placeholder={translate("Project No.", "رقم المشروع")} aria-label={translate("Project Number", "رقم المشروع")} value={projectNumber} onChange={(e) => setProjectNumber(e.currentTarget.value)} />
                    </Table.Th>
                    <Table.Th className="font-normal">
                      <TextInput size="xs" placeholder="EGP" aria-label={translate("Currency", "العملة")} value={currency} onChange={(e) => setCurrency(e.currentTarget.value.toUpperCase())} maxLength={3} />
                    </Table.Th>
                    <Table.Th />
                    <Table.Th />
                    <Table.Th />
                    <Table.Th />
                    <Table.Th className="font-normal">
                      <TextInput size="xs" placeholder={translate("Search", "بحث")} aria-label={translate("Description", "الوصف")} value={description} onChange={(e) => setDescription(e.currentTarget.value)} />
                    </Table.Th>
                    <Table.Th className="font-normal">
                      <Select size="xs" aria-label={translate("Status", "الحالة")} placeholder={translate("All", "الكل")} value={status || null} onChange={(v) => setStatus(v || "")} data={statusOptions} clearable comboboxProps={{ withinPortal: true }} />
                    </Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {paginatedEntries.data.map((entry) => {
                    // The entry-level Balance/Difference = Total Debit - Total Credit (0.00 for a
                    // valid/balanced entry) - NEVER a per-account running balance, which is a
                    // different concept shown only on the General Ledger line view (docs section
                    // "Which balance should the main page show?").
                    const difference = entry.difference ?? Math.round((entry.totalDebit - entry.totalCredit) * 100) / 100;
                    return (
                      <ClickableRow
                        key={entry._id}
                        className="cursor-pointer text-gray-600"
                        onClick={() => navigate(entry._id)}
                      >
                        <Table.Td className="whitespace-nowrap">{formatDate(entry.date, language)}</Table.Td>
                        <Table.Td className="whitespace-nowrap font-medium text-gray-800">{entry.entryNumber}</Table.Td>
                        <Table.Td className="whitespace-nowrap">{displayModuleLabel(entry.module, translate)}</Table.Td>
                        <Table.Td className="whitespace-nowrap">
                          <Badge
                            size="sm"
                            variant="light"
                            color={{ project: "blue", ga: "grape", unclassified: "gray" }[entryClassification(entry)]}
                          >
                            {entryClassificationLabel(entryClassification(entry), translate)}
                          </Badge>
                        </Table.Td>
                        <Table.Td className="whitespace-nowrap">{entry.project?.projectNumber || "-"}</Table.Td>
                        <Table.Td className="whitespace-nowrap">{entry.currency || "-"}</Table.Td>
                        <Table.Td className="whitespace-nowrap text-right tabular-nums">
                          {entry.rate ? formatRate(entry.rate) : "-"}
                        </Table.Td>
                        <Table.Td className="whitespace-nowrap text-right tabular-nums">
                          {entry.totalDebit.toLocaleString()}
                        </Table.Td>
                        <Table.Td className="whitespace-nowrap text-right tabular-nums">
                          {entry.totalCredit.toLocaleString()}
                        </Table.Td>
                        <Table.Td
                          className={`whitespace-nowrap text-right tabular-nums ${difference !== 0 ? "text-red-600" : ""}`}
                        >
                          {difference.toLocaleString()}
                        </Table.Td>
                        <Table.Td>{entry.description || "-"}</Table.Td>
                        <Table.Td className="whitespace-nowrap">
                          <Badge color={statusColors[entry.status] || "gray"} size="sm">
                            {entry.status}
                          </Badge>
                        </Table.Td>
                      </ClickableRow>
                    );
                  })}
                </Table.Tbody>
              </DataTable>
            </DataTableContainer>

            <PaginationHandler paginatedData={paginatedEntries} activePage={activePage} setActivePage={setActivePage} />
          </>
        ))
      )}

      <CreateJournalEntryModal
        opened={createModalOpened}
        close={closeCreateModal}
        onCreated={(entry) => navigate(entry._id)}
      />
    </AdminLayoutBox>
  );
}
