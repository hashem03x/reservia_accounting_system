import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useDisclosure } from "@mantine/hooks";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import useHasPermission from "@/hooks/useHasPermission";
import handleRequest from "@/utils/helpers/handle-request";
import { formatDate } from "@/utils/helpers/date-formaters";
import resources from "@/utils/constants/resources";
import actions from "@/utils/constants/actions";
import { Badge, Button, Table } from "@mantine/core";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import ErrorAlert from "@/components/ui/error-alert";
import paths from "@/utils/constants/paths";
import { JournalEntry } from "@/types/journal-entry";
import ReverseJournalEntryModal from "../_components/reverse-journal-entry-modal";

const statusColors: Record<string, string> = { draft: "yellow", posted: "green", reversed: "gray" };

export default function JournalEntryDetail() {
  const { id } = useParams();
  const { language, translate, translations } = useLanguage();
  const navigate = useNavigate();
  const canUpdate = useHasPermission(resources.journalEntries, actions.update);

  const {
    privateRequest,
    loading,
    setLoading,
    error,
    setError,
    data: entry,
    setData: setEntry,
  } = useDataHandler<JournalEntry | null>({ initialData: null, initialLoading: true });

  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState("");

  useDocumentTitle(entry ? `#${entry.entryNumber} | ${translations.pages.journalEntries}` : translations.pages.journalEntries);

  function load() {
    handleRequest(language, setLoading, setError, async () => {
      const res = await privateRequest({ url: `journal-entries/${id}`, language });
      setEntry(res.data);
    });
  }

  useEffect(() => {
    load();
  }, [id]);

  async function handlePost() {
    handleRequest(language, setActionLoading, setActionError, async () => {
      const res = await privateRequest({ url: `journal-entries/${id}/post`, method: "POST", language });
      setEntry(res.data);
    });
  }

  const [reverseModalOpened, { open: openReverseModal, close: closeReverseModal }] = useDisclosure();

  function handleReversed(reversal: JournalEntry) {
    navigate(`/${paths.admin}/${paths.journalEntries}/${reversal._id}`);
  }

  if (loading) return <LoadingSection message={translate("Loading journal entry...", "جاري تحميل القيد...")} />;
  if (error) return <ErrorSection errorTitle={translate("Error loading journal entry", "خطأ في تحميل القيد")} errorMessage={error} button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: load }} />;
  if (!entry) return null;

  const difference = Math.round((entry.totalDebit - entry.totalCredit) * 100) / 100;

  return (
    <AdminLayoutBox
      header={{
        title: translate(`Journal Entry #${entry.entryNumber}`, `قيد يومية رقم ${entry.entryNumber}`),
        subTitle: entry.description,
        backLink: `/${paths.admin}/${paths.journalEntries}`,
        sideElements: (
          <div className="flex items-center gap-2">
            <Badge color={statusColors[entry.status] || "gray"} size="lg">
              {entry.status}
            </Badge>
            {canUpdate && entry.status === "draft" && (
              <Button loading={actionLoading} onClick={handlePost} disabled={difference !== 0 || entry.lines.length < 2}>
                {translate("Post", "ترحيل")}
              </Button>
            )}
            {canUpdate && entry.status === "posted" && !entry.reversedByEntry && (
              <Button variant="light" color="red" onClick={openReverseModal}>
                {translate("Reverse", "عكس")}
              </Button>
            )}
          </div>
        ),
      }}
    >
      {actionError && <ErrorAlert error={actionError} />}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <InfoCard label={translate("Date", "التاريخ")} value={formatDate(entry.date, language)} />
        <InfoCard label={translate("Source", "المصدر")} value={entry.source} />
        <InfoCard label={translate("Project", "المشروع")} value={entry.project?.projectNumber || "-"} />
        <InfoCard label={translate("Reference", "المرجع")} value={entry.reference || "-"} />
      </div>

      <div className="mt-6 overflow-x-auto">
        <Table striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{translate("Account", "الحساب")}</Table.Th>
              <Table.Th>{translate("Sub Account", "الحساب الفرعي")}</Table.Th>
              <Table.Th>{translate("Project Number", "رقم المشروع")}</Table.Th>
              <Table.Th>{translate("Description", "الوصف")}</Table.Th>
              <Table.Th>{translate("Debit", "مدين")}</Table.Th>
              <Table.Th>{translate("Credit", "دائن")}</Table.Th>
              <Table.Th>{translate("Balance", "الرصيد")}</Table.Th>
              <Table.Th>{translate("Original Currency", "العملة الأصلية")}</Table.Th>
              <Table.Th>{translate("Unearned Revenue", "إيرادات غير مكتسبة")}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {entry.lines.map((line, i) => {
              // Balance = Debit - Credit for this line (credit lines are therefore negative) -
              // NOT the same thing as a Chart of Accounts running balance, which sums this across
              // every posted line for the account - see docs/entities/accounting.md.
              const lineBalance = Math.round(((line.debit || 0) - (line.credit || 0)) * 100) / 100;
              return (
                <Table.Tr key={i}>
                  <Table.Td>
                    {line.account.code} - {line.account.name}
                  </Table.Td>
                  <Table.Td>{line.subAccount ? `${line.subAccount.code} - ${line.subAccount.name}` : "-"}</Table.Td>
                  <Table.Td>{line.projectNumber || "-"}</Table.Td>
                  <Table.Td>{line.description || "-"}</Table.Td>
                  <Table.Td>{line.debit ? line.debit.toLocaleString() : "-"}</Table.Td>
                  <Table.Td>{line.credit ? line.credit.toLocaleString() : "-"}</Table.Td>
                  <Table.Td className={lineBalance < 0 ? "text-red-600" : ""}>{lineBalance.toLocaleString()}</Table.Td>
                  <Table.Td>
                    {line.currency
                      ? `${line.currency}${line.exchangeRate ? ` @ ${line.exchangeRate}` : ""}`
                      : "-"}
                  </Table.Td>
                  <Table.Td>{line.unearnedRevenue ? line.unearnedRevenue.toLocaleString() : "-"}</Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
          <Table.Tfoot>
            <Table.Tr className="font-bold">
              <Table.Td colSpan={4}>{translate("Total", "الإجمالي")}</Table.Td>
              <Table.Td>{entry.totalDebit.toLocaleString()}</Table.Td>
              <Table.Td>{entry.totalCredit.toLocaleString()}</Table.Td>
              <Table.Td colSpan={3} />
            </Table.Tr>
            <Table.Tr>
              <Table.Td colSpan={8} className={difference !== 0 ? "text-red-600" : "text-green-600"}>
                {translate("Difference", "الفرق")}: {difference}
              </Table.Td>
            </Table.Tr>
          </Table.Tfoot>
        </Table>
      </div>

      <ReverseJournalEntryModal opened={reverseModalOpened} close={closeReverseModal} entry={entry} onReversed={handleReversed} />
    </AdminLayoutBox>
  );
}

function InfoCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-gray-200 p-3">
      <span className="text-xs text-gray-500">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}
