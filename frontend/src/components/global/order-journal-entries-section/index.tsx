import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { formatDate } from "@/utils/helpers/date-formaters";
import { JournalEntry } from "@/types/journal-entry";
import { Badge, Table } from "@mantine/core";
import { DataTable, DataTableContainer, dataTableHeadClassName } from "@/components/ui/data-table";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import paths from "@/utils/constants/paths";

const statusColors: Record<string, string> = { draft: "yellow", posted: "green", reversed: "gray" };

<<<<<<< HEAD
export type JournalEntriesSourceType = "sales-order" | "purchase-order" | "advanced-payment";

/**
 * "Accounting / Journal Entries" section shared by the Sales Order, Purchase Order and Advanced
 * Payment detail pages - shows every REAL Journal Entry linked to that document via
 * `GET journal-entries/{sales-order|purchase-order|advanced-payment}/:id` (journalEntryController.js),
 * which resolves the link through persisted references only, never a text match. One request for
 * the whole section (single-entity detail page). A single business event can legitimately produce
 * several entries - each rendered as its own row. Each row opens the full Journal Entry details page.
=======
/**
 * "Accounting / Journal Entries" section shared by the Sales Order and Purchase Order detail
 * pages (docs sections "Sales Order -> Automatic JE Display" / "Purchase Order -> Automatic JE
 * Display") - shows every REAL, already-posted automatic Journal Entry linked to this order via
 * `GET journal-entries/sales-order/:id` or `GET journal-entries/purchase-order/:id`
 * (journalEntryController.js), never a manually fabricated display row. One request for the whole
 * section - acceptable on a single-entity detail page (docs section "Performance" - the no-N+1
 * constraint is about LIST pages). A single business event can legitimately produce several
 * entries (e.g. a PO generating JV003+JV004+JV005+JV007) - each rendered as its own row, lines
 * never flattened together here. Each row links to the full Journal Entry details page.
>>>>>>> 368811657e0eba1f2e8b46ee732d01745194d628
 */
export default function OrderJournalEntriesSection({
  orderType,
  orderId,
<<<<<<< HEAD
  emptyMessage,
}: {
  orderType: JournalEntriesSourceType;
  orderId: string;
  emptyMessage?: string;
=======
}: {
  orderType: "sales-order" | "purchase-order";
  orderId: string;
>>>>>>> 368811657e0eba1f2e8b46ee732d01745194d628
}) {
  const { language, translate } = useLanguage();
  const navigate = useNavigate();

  const {
    privateRequest,
    loading,
    setLoading,
    error,
    setError,
    data: entries,
    setData: setEntries,
  } = useDataHandler<JournalEntry[]>({ initialData: [], initialLoading: true });

  function load() {
    handleRequest(language, setLoading, setError, async () => {
      const res = await privateRequest({ url: `journal-entries/${orderType}/${orderId}`, language });
<<<<<<< HEAD
      setEntries(Array.isArray(res?.data) ? res.data : []);
=======
      setEntries(res.data);
>>>>>>> 368811657e0eba1f2e8b46ee732d01745194d628
    });
  }

  useEffect(() => {
<<<<<<< HEAD
    if (orderId) load();
=======
    load();
>>>>>>> 368811657e0eba1f2e8b46ee732d01745194d628
  }, [orderId]);

  if (loading) return <LoadingSection message={translate("Loading journal entries...", "جاري تحميل القيود...")} />;
  if (error) {
    return (
      <ErrorSection
        errorTitle={translate("Error loading journal entries", "خطأ في تحميل القيود")}
        errorMessage={error}
        button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: load }}
      />
    );
  }

  if (entries.length === 0) {
    return (
      <p className="text-sm text-gray-500">
<<<<<<< HEAD
        {emptyMessage ||
          translate("No automatic journal entries have been posted for this order yet.", "لم يتم ترحيل أي قيود يومية تلقائية لهذا الطلب حتى الآن.")}
=======
        {translate("No automatic journal entries have been posted for this order yet.", "لم يتم ترحيل أي قيود يومية تلقائية لهذا الطلب حتى الآن.")}
>>>>>>> 368811657e0eba1f2e8b46ee732d01745194d628
      </p>
    );
  }

  return (
    <DataTableContainer>
<<<<<<< HEAD
      <DataTable className="min-w-[1000px]">
        <Table.Thead className={dataTableHeadClassName}>
          <Table.Tr>
            <Table.Th className="whitespace-nowrap">{translate("Entry Number", "رقم القيد")}</Table.Th>
            <Table.Th className="whitespace-nowrap">{translate("Date", "التاريخ")}</Table.Th>
            <Table.Th>{translate("Description", "الوصف")}</Table.Th>
            <Table.Th className="whitespace-nowrap">{translate("Module", "الوحدة")}</Table.Th>
            <Table.Th className="whitespace-nowrap">{translate("Project Number", "رقم المشروع")}</Table.Th>
            <Table.Th className="whitespace-nowrap text-right">{translate("Debit", "مدين")}</Table.Th>
            <Table.Th className="whitespace-nowrap text-right">{translate("Credit", "دائن")}</Table.Th>
=======
      <DataTable className="min-w-[900px]">
        <Table.Thead className={dataTableHeadClassName}>
          <Table.Tr>
            <Table.Th className="whitespace-nowrap">{translate("Document Number", "رقم المستند")}</Table.Th>
            <Table.Th className="whitespace-nowrap">{translate("Date", "التاريخ")}</Table.Th>
            <Table.Th className="whitespace-nowrap">{translate("Module", "الوحدة")}</Table.Th>
            <Table.Th className="whitespace-nowrap">{translate("Project", "المشروع")}</Table.Th>
            <Table.Th className="whitespace-nowrap text-right">{translate("Debit", "مدين")}</Table.Th>
            <Table.Th className="whitespace-nowrap text-right">{translate("Credit", "دائن")}</Table.Th>
            <Table.Th className="whitespace-nowrap text-right">{translate("Balance", "الرصيد")}</Table.Th>
>>>>>>> 368811657e0eba1f2e8b46ee732d01745194d628
            <Table.Th className="whitespace-nowrap">{translate("Status", "الحالة")}</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
<<<<<<< HEAD
          {entries.map((entry) => (
            <Table.Tr
              key={entry._id}
              className="cursor-pointer text-gray-600"
              onClick={() => navigate(`/${paths.admin}/${paths.journalEntries}/${entry._id}`)}
            >
              <Table.Td className="whitespace-nowrap font-medium text-gray-800">#{entry.entryNumber}</Table.Td>
              <Table.Td className="whitespace-nowrap">{entry.date ? formatDate(entry.date, language) : "-"}</Table.Td>
              <Table.Td className="max-w-[320px] truncate" title={entry.description || ""}>
                {entry.description || "-"}
              </Table.Td>
              <Table.Td className="whitespace-nowrap">{entry.module || "-"}</Table.Td>
              <Table.Td className="whitespace-nowrap">{entry.project?.projectNumber || "-"}</Table.Td>
              <Table.Td className="whitespace-nowrap text-right tabular-nums">{(entry.totalDebit || 0).toLocaleString()}</Table.Td>
              <Table.Td className="whitespace-nowrap text-right tabular-nums">{(entry.totalCredit || 0).toLocaleString()}</Table.Td>
              <Table.Td className="whitespace-nowrap">
                <Badge color={statusColors[entry.status] || "gray"} size="sm">
                  {entry.status}
                </Badge>
              </Table.Td>
              <Table.Td className="whitespace-nowrap text-blue-600">{translate("View Entry →", "عرض القيد ←")}</Table.Td>
            </Table.Tr>
          ))}
=======
          {entries.map((entry) => {
            // Entry-level Difference (Total Debit - Total Credit), never a per-account running
            // balance - same rule as the main Journal Entries listing.
            const difference = Math.round(((entry.totalDebit || 0) - (entry.totalCredit || 0)) * 100) / 100;
            return (
              <Table.Tr
                key={entry._id}
                className="cursor-pointer text-gray-600"
                onClick={() => navigate(`/${paths.admin}/home/${paths.journalEntries}/${entry._id}`)}
              >
                <Table.Td className="whitespace-nowrap font-medium text-gray-800">{entry.entryNumber}</Table.Td>
                <Table.Td className="whitespace-nowrap">{formatDate(entry.date, language)}</Table.Td>
                <Table.Td className="whitespace-nowrap">{entry.module || "-"}</Table.Td>
                <Table.Td className="whitespace-nowrap">{entry.project?.projectNumber || "-"}</Table.Td>
                <Table.Td className="whitespace-nowrap text-right tabular-nums">{entry.totalDebit.toLocaleString()}</Table.Td>
                <Table.Td className="whitespace-nowrap text-right tabular-nums">{entry.totalCredit.toLocaleString()}</Table.Td>
                <Table.Td className={`whitespace-nowrap text-right tabular-nums ${difference !== 0 ? "text-red-600" : ""}`}>
                  {difference.toLocaleString()}
                </Table.Td>
                <Table.Td className="whitespace-nowrap">
                  <Badge color={statusColors[entry.status] || "gray"} size="sm">
                    {entry.status}
                  </Badge>
                </Table.Td>
                <Table.Td className="whitespace-nowrap text-blue-600">{translate("View Entry →", "عرض القيد ←")}</Table.Td>
              </Table.Tr>
            );
          })}
>>>>>>> 368811657e0eba1f2e8b46ee732d01745194d628
        </Table.Tbody>
      </DataTable>
    </DataTableContainer>
  );
}
