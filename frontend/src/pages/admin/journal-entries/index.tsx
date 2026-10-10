import { JournalEntry } from "@/types/journal-entry";
import { PaginatedData } from "@/types/global";
import { useEffect, useState } from "react";
import { useDisclosure } from "@mantine/hooks";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import useHasPermission from "@/hooks/useHasPermission";
import handleRequest from "@/utils/helpers/handle-request";
import { formatDate } from "@/utils/helpers/date-formaters";
import { DEFAULT_ITEMS_PER_PAGE } from "@/utils/constants";
import resources from "@/utils/constants/resources";
import actions from "@/utils/constants/actions";
import { Badge, Button, Table } from "@mantine/core";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import EmptySection from "@/components/ui/sections/empty";
import PaginationHandler from "@/components/ui/pagination-handler";
import { DataTable, DataTableContainer, dataTableHeadClassName } from "@/components/ui/data-table";
import CreateJournalEntryModal from "./_components/create-journal-entry-modal";

const ITEMS_PER_PAGE = import.meta.env.VITE_ITEMS_PER_PAGE || DEFAULT_ITEMS_PER_PAGE;

const statusColors: Record<string, string> = { draft: "yellow", posted: "green", reversed: "gray" };

export default function JournalEntries() {
  const { language, translate, translations } = useLanguage();
  const navigate = useNavigate();
  const canCreate = useHasPermission(resources.journalEntries, actions.create);

  useDocumentTitle(`${translations.pages.journalEntries} | ${translations.adminPanel}`);

  const [searchParams, setSearchParams] = useSearchParams();
  const [activePage, setActivePage] = useState(parseInt(searchParams.get("page") || "1"));
  const params = { page: activePage.toString() };

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
        params: { limit: ITEMS_PER_PAGE, sort: "entryNumber", ...params },
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
    window.scrollTo({ top: 0, behavior: "instant" });
    const cancelRequest = handleLoadEntries();
    return cancelRequest;
  }, [activePage]);

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
          <EmptySection useDefaultImg message={translate("No journal entries found", "لا توجد قيود يومية")} />
        ) : (
          <>
            {/* Shared table visual system (see components/ui/data-table.tsx), first established on
                the Chart of Accounts table. Columns below are this page's own - only the
                container/header/row presentation is shared. */}
            <DataTableContainer>
              <DataTable className="min-w-[1200px]">
                <Table.Thead className={dataTableHeadClassName}>
                  <Table.Tr>
                    <Table.Th className="whitespace-nowrap">{translate("Document Date", "تاريخ المستند")}</Table.Th>
                    <Table.Th className="whitespace-nowrap">{translate("Document Number", "رقم المستند")}</Table.Th>
                    <Table.Th className="whitespace-nowrap">{translate("Module", "الوحدة")}</Table.Th>
                    <Table.Th className="whitespace-nowrap">{translate("Project Number", "رقم المشروع")}</Table.Th>
                    <Table.Th className="whitespace-nowrap">{translate("Currency", "العملة")}</Table.Th>
                    <Table.Th className="whitespace-nowrap text-right">{translate("Rate", "السعر")}</Table.Th>
                    <Table.Th className="whitespace-nowrap text-right">{translate("Total Debit", "إجمالي المدين")}</Table.Th>
                    <Table.Th className="whitespace-nowrap text-right">
                      {translate("Total Credit", "إجمالي الدائن")}
                    </Table.Th>
                    <Table.Th className="whitespace-nowrap text-right">{translate("Balance", "الرصيد")}</Table.Th>
                    <Table.Th>{translate("Description", "الوصف")}</Table.Th>
                    <Table.Th className="whitespace-nowrap">{translate("Status", "الحالة")}</Table.Th>
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
                      <Table.Tr key={entry._id} className="cursor-pointer text-gray-600" onClick={() => navigate(entry._id)}>
                        <Table.Td className="whitespace-nowrap">{formatDate(entry.date, language)}</Table.Td>
                        <Table.Td className="whitespace-nowrap font-medium text-gray-800">{entry.entryNumber}</Table.Td>
                        <Table.Td className="whitespace-nowrap">{entry.module || "-"}</Table.Td>
                        <Table.Td className="whitespace-nowrap">{entry.project?.projectNumber || "-"}</Table.Td>
                        <Table.Td className="whitespace-nowrap">{entry.currency || "-"}</Table.Td>
                        <Table.Td className="whitespace-nowrap text-right tabular-nums">
                          {entry.rate ? entry.rate.toLocaleString() : "-"}
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
                      </Table.Tr>
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
