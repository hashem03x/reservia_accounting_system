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
import { Badge, Button, Table, Tooltip } from "@mantine/core";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import ErrorAlert from "@/components/ui/error-alert";
import paths from "@/utils/constants/paths";
<<<<<<< HEAD
import { JournalEntry, JournalLine } from "@/types/journal-entry";
import { groupJournalLines } from "@/utils/helpers/journal-lines";
=======
import { JournalEntry } from "@/types/journal-entry";
>>>>>>> 368811657e0eba1f2e8b46ee732d01745194d628
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

  // Source: Sales/Purchase Order two-way navigation (docs section "Source Link") - only shown when
  // a valid, backend-authoritative relationship exists (never guessed from description/customer
  // name/Project Number). `triggeredBySalesOrder` is already populated on the entry itself (no
  // extra request needed) - it's the one reliable link for PROJECT_REVENUE_RECOGNITION/
  // PROJECT_COST_RECOGNITION entries, whose own sourceId is a project+percentage hash. A direct
  // sourceType 'SO'/'PO' entry has only the raw order id, so its code is fetched with one extra
  // request - acceptable on a single-entity detail page (docs section "Performance").
  const [sourceOrder, setSourceOrder] = useState<{ _id: string; code?: string } | null>(null);

  useEffect(() => {
    setSourceOrder(null);
    if (!entry) return;
    if (entry.triggeredBySalesOrder) {
      setSourceOrder(entry.triggeredBySalesOrder);
      return;
    }
    if (entry.sourceType === "SO" && entry.sourceId) {
      privateRequest({ url: `sale-orders/${entry.sourceId}`, language })
        .then((res) => setSourceOrder(res.data))
        .catch(() => setSourceOrder(null));
    } else if (entry.sourceType === "PO" && entry.sourceId) {
      privateRequest({ url: `purchaseOrder/${entry.sourceId}`, language })
        .then((res) => setSourceOrder(res.data))
        .catch(() => setSourceOrder(null));
    }
  }, [entry?._id]);

  const sourceOrderIsSalesOrder = entry?.triggeredBySalesOrder != null || entry?.sourceType === "SO";

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

<<<<<<< HEAD
  const lines = entry.lines || [];
  const { debitLines, creditLines } = groupJournalLines(lines);
  const difference = Math.round(((entry.totalDebit || 0) - (entry.totalCredit || 0)) * 100) / 100;
=======
  const difference = Math.round((entry.totalDebit - entry.totalCredit) * 100) / 100;
>>>>>>> 368811657e0eba1f2e8b46ee732d01745194d628

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
<<<<<<< HEAD
              <Button loading={actionLoading} onClick={handlePost} disabled={difference !== 0 || lines.length < 2}>
=======
              <Button loading={actionLoading} onClick={handlePost} disabled={difference !== 0 || entry.lines.length < 2}>
>>>>>>> 368811657e0eba1f2e8b46ee732d01745194d628
                {translate("Post", "ترحيل")}
              </Button>
            )}
            {canUpdate && entry.status === "posted" && (
              <Tooltip
                label={
                  entry.reversedByEntry
                    ? translate("This entry has already been reversed and cannot be reversed again.", "تم عكس هذا القيد بالفعل ولا يمكن عكسه مرة أخرى.")
                    : entry.reversalOfEntry
                      ? translate("A reversal entry cannot itself be reversed.", "لا يمكن عكس قيد عكس بحد ذاته.")
                      : ""
                }
                disabled={!entry.reversedByEntry && !entry.reversalOfEntry}
              >
                <Button
                  variant="light"
                  color="red"
                  onClick={openReverseModal}
                  disabled={!!entry.reversedByEntry || !!entry.reversalOfEntry}
                >
                  {translate("Reverse", "عكس")}
                </Button>
              </Tooltip>
            )}
          </div>
        ),
      }}
    >
      {actionError && <ErrorAlert error={actionError} />}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <InfoCard label={translate("Date", "التاريخ")} value={formatDate(entry.date, language)} />
        <InfoCard label={translate("Source", "المصدر")} value={entry.source} />
        <InfoCard label={translate("Module", "الوحدة")} value={entry.module || "-"} />
        <InfoCard label={translate("Project", "المشروع")} value={entry.project?.projectNumber || "-"} />
        <InfoCard label={translate("Reference", "المرجع")} value={entry.reference || "-"} />
        {sourceOrder && (
          <InfoCard
            label={translate("Source Document", "المستند المصدر")}
            value={
              <button
                type="button"
                className="text-blue-600 hover:underline"
                onClick={() =>
                  navigate(
                    `/${paths.admin}/${sourceOrderIsSalesOrder ? paths.salesOrders : paths.purchaseOrders}/${sourceOrder._id}`
                  )
                }
              >
                {sourceOrderIsSalesOrder
                  ? translate(`Sales Order ${sourceOrder.code || sourceOrder._id} → View Sales Order`, `طلب بيع ${sourceOrder.code || sourceOrder._id} ← عرض طلب البيع`)
                  : translate(`Purchase Order ${sourceOrder.code || sourceOrder._id} → View Purchase Order`, `طلب شراء ${sourceOrder.code || sourceOrder._id} ← عرض طلب الشراء`)}
              </button>
            }
          />
        )}
        {entry.reversedByEntry && (
          <InfoCard
            label={translate("Reversed By", "تم عكسه بواسطة")}
            value={
              <button
                type="button"
                className="text-blue-600 hover:underline"
                onClick={() => navigate(`/${paths.admin}/${paths.journalEntries}/${entry.reversedByEntry}`)}
              >
                {translate("View reversal entry", "عرض قيد العكس")}
              </button>
            }
          />
        )}
        {entry.reversalOfEntry && (
          <InfoCard
            label={translate("Reverses", "يعكس")}
            value={
              <button
                type="button"
                className="text-blue-600 hover:underline"
                onClick={() => navigate(`/${paths.admin}/${paths.journalEntries}/${entry.reversalOfEntry}`)}
              >
                {translate("View original entry", "عرض القيد الأصلي")}
              </button>
            }
          />
        )}
      </div>

<<<<<<< HEAD
      {/* Lines are grouped for presentation only - every Debit line first, then every Credit line
          (each group keeps its original relative order). The persisted entry is never reordered. */}
      <div className="mt-6 overflow-x-auto">
        <Table striped className="min-w-[860px]">
=======
      <div className="mt-6 overflow-x-auto">
        <Table striped>
>>>>>>> 368811657e0eba1f2e8b46ee732d01745194d628
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{translate("Account", "الحساب")}</Table.Th>
              <Table.Th>{translate("Sub Account", "الحساب الفرعي")}</Table.Th>
              <Table.Th>{translate("Project Number", "رقم المشروع")}</Table.Th>
              <Table.Th>{translate("Description", "الوصف")}</Table.Th>
<<<<<<< HEAD
              <Table.Th className="text-right">{translate("Debit", "مدين")}</Table.Th>
              <Table.Th className="text-right">{translate("Credit", "دائن")}</Table.Th>
              <Table.Th className="text-right">{translate("Balance", "الرصيد")}</Table.Th>
              <Table.Th>{translate("Original Currency", "العملة الأصلية")}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {lines.length === 0 ? (
              <Table.Tr>
                <Table.Td colSpan={LINE_COLUMNS} className="text-center text-gray-400">
                  {translate("This entry has no lines.", "لا توجد سطور لهذا القيد.")}
                </Table.Td>
              </Table.Tr>
            ) : (
              <>
                {debitLines.length > 0 && (
                  <LineGroupHeader label={translate("Debit", "مدين")} color="text-blue-700" />
                )}
                {debitLines.map(({ line, originalIndex }) => (
                  <JournalLineRow key={`d-${originalIndex}`} line={line} />
                ))}
                {creditLines.length > 0 && (
                  <LineGroupHeader label={translate("Credit", "دائن")} color="text-orange-700" />
                )}
                {creditLines.map(({ line, originalIndex }) => (
                  <JournalLineRow key={`c-${originalIndex}`} line={line} />
                ))}
              </>
            )}
=======
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
                  <Table.Td>
                    {/* The automatic accounting engine stamps partyNumber/partyType (the resolved
                        Customer/Vendor Number) directly on the one control-account line - a manual
                        entry instead uses the ChartOfAccount-reference `subAccount` field. Never
                        both at once; prefer the resolved party number when present. */}
                    {line.partyType && line.partyNumber != null
                      ? line.partyNumber
                      : line.subAccount
                        ? `${line.subAccount.code} - ${line.subAccount.name}`
                        : "-"}
                  </Table.Td>
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
>>>>>>> 368811657e0eba1f2e8b46ee732d01745194d628
          </Table.Tbody>
          <Table.Tfoot>
            <Table.Tr className="font-bold">
              <Table.Td colSpan={4}>{translate("Total", "الإجمالي")}</Table.Td>
<<<<<<< HEAD
              <Table.Td className="text-right tabular-nums">{(entry.totalDebit || 0).toLocaleString()}</Table.Td>
              <Table.Td className="text-right tabular-nums">{(entry.totalCredit || 0).toLocaleString()}</Table.Td>
              <Table.Td colSpan={2} />
            </Table.Tr>
            <Table.Tr>
              <Table.Td colSpan={LINE_COLUMNS} className={difference !== 0 ? "text-red-600" : "text-green-600"}>
=======
              <Table.Td>{entry.totalDebit.toLocaleString()}</Table.Td>
              <Table.Td>{entry.totalCredit.toLocaleString()}</Table.Td>
              <Table.Td colSpan={3} />
            </Table.Tr>
            <Table.Tr>
              <Table.Td colSpan={8} className={difference !== 0 ? "text-red-600" : "text-green-600"}>
>>>>>>> 368811657e0eba1f2e8b46ee732d01745194d628
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

<<<<<<< HEAD
const LINE_COLUMNS = 8;

function LineGroupHeader({ label, color }: { label: string; color: string }) {
  return (
    <Table.Tr className="bg-gray-100">
      <Table.Td colSpan={LINE_COLUMNS} className={`text-xs font-bold uppercase tracking-wide ${color}`}>
        {label}
      </Table.Td>
    </Table.Tr>
  );
}

function JournalLineRow({ line }: { line: JournalLine }) {
  // Balance = Debit - Credit for this line (credit lines are therefore negative) - NOT the same
  // thing as a Chart of Accounts running balance, which sums this across every posted line for the
  // account - see docs/entities/accounting.md.
  const debit = Number(line.debit) || 0;
  const credit = Number(line.credit) || 0;
  const lineBalance = Math.round((debit - credit) * 100) / 100;
  return (
    <Table.Tr>
      <Table.Td>{line.account ? `${line.account.code} - ${line.account.name}` : "-"}</Table.Td>
      <Table.Td>
        {/* The automatic accounting engine stamps partyNumber/partyType (the resolved Customer/
            Vendor Number) directly on the one control-account line - a manual entry instead uses the
            ChartOfAccount-reference `subAccount` field. Prefer the resolved party number. */}
        {line.partyType && line.partyNumber != null
          ? line.partyNumber
          : line.subAccount
            ? `${line.subAccount.code} - ${line.subAccount.name}`
            : "-"}
      </Table.Td>
      <Table.Td>{line.projectNumber || line.project?.projectNumber || "-"}</Table.Td>
      <Table.Td>{line.description || "-"}</Table.Td>
      <Table.Td className="text-right tabular-nums">{debit ? debit.toLocaleString() : "-"}</Table.Td>
      <Table.Td className="text-right tabular-nums">{credit ? credit.toLocaleString() : "-"}</Table.Td>
      <Table.Td className={`text-right tabular-nums ${lineBalance < 0 ? "text-red-600" : ""}`}>{lineBalance.toLocaleString()}</Table.Td>
      <Table.Td>{line.currency ? `${line.currency}${line.exchangeRate ? ` @ ${line.exchangeRate}` : ""}` : "-"}</Table.Td>
    </Table.Tr>
  );
}

=======
>>>>>>> 368811657e0eba1f2e8b46ee732d01745194d628
function InfoCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-gray-200 p-3">
      <span className="text-xs text-gray-500">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}
