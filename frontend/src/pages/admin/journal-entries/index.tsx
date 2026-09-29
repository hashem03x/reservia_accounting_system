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
        params: { limit: ITEMS_PER_PAGE, sort: "-date", ...params },
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
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{translate("Entry Number", "رقم القيد")}</Table.Th>
                  <Table.Th>{translate("Date", "التاريخ")}</Table.Th>
                  <Table.Th>{translate("Source", "المصدر")}</Table.Th>
                  <Table.Th>{translate("Description", "الوصف")}</Table.Th>
                  <Table.Th>{translate("Project", "المشروع")}</Table.Th>
                  <Table.Th>{translate("Debit", "مدين")}</Table.Th>
                  <Table.Th>{translate("Credit", "دائن")}</Table.Th>
                  <Table.Th>{translate("Status", "الحالة")}</Table.Th>
                  <Table.Th>{translate("Actions", "الإجراءات")}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {paginatedEntries.data.map((entry) => (
                  <Table.Tr key={entry._id} className="cursor-pointer" onClick={() => navigate(entry._id)}>
                    <Table.Td className="font-medium">{entry.entryNumber}</Table.Td>
                    <Table.Td>{formatDate(entry.date, language)}</Table.Td>
                    <Table.Td>{entry.source}</Table.Td>
                    <Table.Td>{entry.description}</Table.Td>
                    <Table.Td>{entry.project?.projectNumber || "-"}</Table.Td>
                    <Table.Td>{entry.totalDebit.toLocaleString()}</Table.Td>
                    <Table.Td>{entry.totalCredit.toLocaleString()}</Table.Td>
                    <Table.Td>
                      <Badge color={statusColors[entry.status] || "gray"} variant="light">
                        {entry.status}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Button
                        variant="light"
                        size="xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(entry._id);
                        }}
                      >
                        {translate("View", "عرض")}
                      </Button>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>

            <PaginationHandler paginatedData={paginatedEntries} activePage={activePage} setActivePage={setActivePage} />
          </>
        ))
      )}

      <CreateJournalEntryModal opened={createModalOpened} close={closeCreateModal} onCreated={(entry) => navigate(entry._id)} />
    </AdminLayoutBox>
  );
}
