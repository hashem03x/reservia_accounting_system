import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Badge, Table } from "@mantine/core";
import { JournalEntry } from "@/types/journal-entry";
import { PaginatedData } from "@/types/global";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import useHasPermission from "@/hooks/useHasPermission";
import handleRequest from "@/utils/helpers/handle-request";
import { formatCurrency } from "@/utils/helpers/format-currency";
import { formatDate } from "@/utils/helpers/date-formaters";
import resources from "@/utils/constants/resources";
import actions from "@/utils/constants/actions";
import paths from "@/utils/constants/paths";
import SectionCard from "@/components/ui/section-card";
import { DataTable, DataTableContainer, dataTableHeadClassName } from "@/components/ui/data-table";
import TruncatedText from "@/components/ui/truncated-text";
import EmptySection from "@/components/ui/sections/empty";
import ErrorSection from "@/components/ui/sections/error";
import LoadingSection from "@/components/ui/sections/loading";

const statusColors: Record<string, string> = { draft: "gray", posted: "green", reversed: "red" };

// Recent Journal Entries (docs section "Recent Journal Entries") - a compact slice of the entry
// list (newest first), not the full Journal Entries/General Ledger table. Shown at entry
// granularity (totalDebit/totalCredit, already server-computed) rather than re-flattening into
// per-line Account/Sub Account rows here - that full breakdown is what "View all" leads to.
export default function RecentJournalEntriesSection() {
  const { language, translate } = useLanguage();
  const navigate = useNavigate();
  const canRead = useHasPermission(resources.journalEntries, actions.read);

  const { privateRequest, loading, setLoading, error, setError, data, setData } =
    useDataHandler<PaginatedData<JournalEntry> | null>({
      initialData: null,
      initialLoading: true,
    });

  function load() {
    const controller = new AbortController();
    const canceled = { current: false };

    const executeFetch = async () => {
      const response = await privateRequest({
        url: "journal-entries",
        params: { limit: "5", sort: "-createdAt" },
        signal: controller.signal,
        language,
      });
      setData(response);
    };

    handleRequest(language, setLoading, setError, executeFetch, canceled);

    return () => {
      controller.abort();
      canceled.current = true;
    };
  }

  useEffect(() => {
    if (!canRead) return;
    const cancelRequest = load();
    return cancelRequest;
  }, [canRead]);

  if (!canRead) return null;

  return (
    <SectionCard
      title={translate("Recent Journal Entries", "آخر القيود اليومية")}
      viewAllTo={`/${paths.admin}/${paths.journalEntries}`}
      viewAllLabel={translate("View all", "عرض الكل")}
    >
      {loading ? (
        <LoadingSection message={translate("Loading journal entries...", "جاري تحميل القيود...")} />
      ) : error ? (
        <ErrorSection
          errorTitle={translate("Error loading journal entries", "خطأ في تحميل القيود")}
          errorMessage={error}
          button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: load }}
        />
      ) : !data || data.data.length === 0 ? (
        <EmptySection useDefaultImg message={translate("No journal entries yet", "لا توجد قيود يومية")} />
      ) : (
        <DataTableContainer>
          <DataTable className="min-w-[560px]">
            <Table.Thead className={dataTableHeadClassName}>
              <Table.Tr>
                <Table.Th className="whitespace-nowrap">{translate("Date", "التاريخ")}</Table.Th>
                <Table.Th className="whitespace-nowrap">{translate("Document #", "رقم المستند")}</Table.Th>
                <Table.Th>{translate("Project / Desc.", "المشروع / الوصف")}</Table.Th>
                <Table.Th className="whitespace-nowrap text-right">{translate("Debit", "مدين")}</Table.Th>
                <Table.Th className="whitespace-nowrap text-right">{translate("Credit", "دائن")}</Table.Th>
                <Table.Th className="whitespace-nowrap">{translate("Status", "الحالة")}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data.data.map((entry) => (
                <Table.Tr
                  key={entry._id}
                  className="cursor-pointer"
                  onClick={() => navigate(`/${paths.admin}/${paths.journalEntries}/${entry._id}`)}
                >
                  <Table.Td className="whitespace-nowrap">{formatDate(entry.date, language)}</Table.Td>
                  <Table.Td className="whitespace-nowrap font-medium">{entry.entryNumber}</Table.Td>
                  <Table.Td>
                    <TruncatedText text={projectOrDescription(entry)} maxWidthClassName="max-w-[200px]" />
                  </Table.Td>
                  <Table.Td className="whitespace-nowrap text-right tabular-nums">
                    {formatCurrency(entry.totalDebit, language)}
                  </Table.Td>
                  <Table.Td className="whitespace-nowrap text-right tabular-nums">
                    {formatCurrency(entry.totalCredit, language)}
                  </Table.Td>
                  <Table.Td className="whitespace-nowrap">
                    <Badge color={statusColors[entry.status] || "gray"} variant="light">
                      {entry.status}
                    </Badge>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </DataTable>
        </DataTableContainer>
      )}
    </SectionCard>
  );
}

function projectOrDescription(entry: JournalEntry) {
  if (entry.project) return `${entry.project.projectNumber}${entry.project.name ? ` - ${entry.project.name}` : ""}`;
  return entry.description || "-";
}
