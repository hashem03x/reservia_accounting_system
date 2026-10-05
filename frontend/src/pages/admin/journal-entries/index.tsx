import { GeneralLedgerRow } from "@/types/journal-entry";
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
import { Button, Table } from "@mantine/core";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import EmptySection from "@/components/ui/sections/empty";
import PaginationHandler from "@/components/ui/pagination-handler";
import { DataTable, DataTableContainer, dataTableHeadClassName } from "@/components/ui/data-table";
import CreateJournalEntryModal from "./_components/create-journal-entry-modal";

const ITEMS_PER_PAGE = import.meta.env.VITE_ITEMS_PER_PAGE || DEFAULT_ITEMS_PER_PAGE;

export default function JournalEntries() {
  const { language, translate, translations } = useLanguage();
  const navigate = useNavigate();
  const canCreate = useHasPermission(resources.journalEntries, actions.create);

  useDocumentTitle(`${translations.pages.journalEntries} | ${translations.adminPanel}`);

  const [searchParams, setSearchParams] = useSearchParams();
  const [activePage, setActivePage] = useState(parseInt(searchParams.get("page") || "1"));
  const params = { page: activePage.toString() };

  // The General Ledger line view (docs section "Journal Entries / General Ledger table") - one
  // row per JournalEntry LINE (not per entry), each already carrying its own resolved Sub Account
  // and running balance from the backend (services/accounting/generalLedgerService.js) - never
  // computed here in React.
  const {
    privateRequest,
    loading,
    setLoading,
    error,
    setError,
    data: paginatedLines,
    setData: setPaginatedLines,
  } = useDataHandler<PaginatedData<GeneralLedgerRow>>({ initialData: null, initialLoading: true });

  function handleLoadEntries() {
    const controller = new AbortController();
    const canceled = { current: false };

    const executeFetch = async () => {
      const response = await privateRequest({
        url: "journal-entries/general-ledger",
        params: { limit: ITEMS_PER_PAGE, ...params },
        signal: controller.signal,
        language,
      });
      setPaginatedLines(response);
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
        paginatedLines &&
        (paginatedLines.data.length === 0 ? (
          <EmptySection useDefaultImg message={translate("No journal entries found", "لا توجد قيود يومية")} />
        ) : (
          <>
            {/* Shared table visual system (see components/ui/data-table.tsx), first established on
                the Chart of Accounts table. Columns below are this page's own - only the
                container/header/row presentation is shared. */}
            <DataTableContainer>
              <DataTable className="min-w-[1280px]">
                <Table.Thead className={dataTableHeadClassName}>
                  <Table.Tr>
                    <Table.Th className="whitespace-nowrap">{translate("Document Date", "تاريخ المستند")}</Table.Th>
                    <Table.Th className="whitespace-nowrap">{translate("Document Number", "رقم المستند")}</Table.Th>
                    <Table.Th className="whitespace-nowrap">{translate("Acc Number", "رقم الحساب")}</Table.Th>
                    <Table.Th className="whitespace-nowrap">{translate("Sub Account", "الحساب الفرعي")}</Table.Th>
                    <Table.Th>{translate("ACC Name", "اسم الحساب")}</Table.Th>
                    <Table.Th className="whitespace-nowrap">{translate("Project Number", "رقم المشروع")}</Table.Th>
                    <Table.Th className="whitespace-nowrap">{translate("Currency", "العملة")}</Table.Th>
                    <Table.Th className="whitespace-nowrap text-right">{translate("Rate", "السعر")}</Table.Th>
                    <Table.Th className="whitespace-nowrap text-right">{translate("Debit", "مدين")}</Table.Th>
                    <Table.Th className="whitespace-nowrap text-right">{translate("Credit", "دائن")}</Table.Th>
                    <Table.Th className="whitespace-nowrap text-right">
                      {translate("Balance (Document Currency)", "الرصيد (عملة المستند)")}
                    </Table.Th>
                    <Table.Th className="whitespace-nowrap text-right">
                      {translate("Balance (Local Currency)", "الرصيد (العملة المحلية)")}
                    </Table.Th>
                    <Table.Th>{translate("Desc.", "الوصف")}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {paginatedLines.data.map((row) => (
                    <Table.Tr
                      key={`${row.entryId}-${row.lineIndex}`}
                      className="cursor-pointer text-gray-600"
                      onClick={() => navigate(row.entryId)}
                    >
                      <Table.Td className="whitespace-nowrap">{formatDate(row.documentDate, language)}</Table.Td>
                      <Table.Td className="whitespace-nowrap font-medium text-gray-800">{row.documentNumber}</Table.Td>
                      <Table.Td className="whitespace-nowrap">{row.accNumber || "-"}</Table.Td>
                      <Table.Td className="whitespace-nowrap">{row.subAccount ? row.subAccount.number : "-"}</Table.Td>
                      <Table.Td>{row.accName || "-"}</Table.Td>
                      <Table.Td className="whitespace-nowrap">{row.projectNumber || "-"}</Table.Td>
                      <Table.Td className="whitespace-nowrap">{row.currency || translations.currency}</Table.Td>
                      <Table.Td className="whitespace-nowrap text-right tabular-nums">{row.rate.toLocaleString()}</Table.Td>
                      <Table.Td className="whitespace-nowrap text-right tabular-nums">
                        {row.debit ? row.debit.toLocaleString() : "-"}
                      </Table.Td>
                      <Table.Td className="whitespace-nowrap text-right tabular-nums">
                        {row.credit ? row.credit.toLocaleString() : "-"}
                      </Table.Td>
                      <Table.Td
                        className={`whitespace-nowrap text-right tabular-nums ${row.balanceDocumentCurrency < 0 ? "text-red-600" : ""}`}
                      >
                        {row.balanceDocumentCurrency.toLocaleString()}
                      </Table.Td>
                      <Table.Td
                        className={`whitespace-nowrap text-right tabular-nums ${row.balanceLocalCurrency < 0 ? "text-red-600" : ""}`}
                      >
                        {row.balanceLocalCurrency.toLocaleString()}
                      </Table.Td>
                      <Table.Td>{row.description || "-"}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </DataTable>
            </DataTableContainer>

            <PaginationHandler paginatedData={paginatedLines} activePage={activePage} setActivePage={setActivePage} />
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
