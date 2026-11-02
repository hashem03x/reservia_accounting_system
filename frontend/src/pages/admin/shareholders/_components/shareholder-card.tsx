import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useDisclosure } from "@mantine/hooks";
import { useLanguage } from "@/context/LanguageContext";
import useHasPermission from "@/hooks/useHasPermission";
import { formatDate } from "@/utils/helpers/date-formaters";
import { formatAmount } from "@/utils/helpers/format-amount";
import paths from "@/utils/constants/paths";
import resources from "@/utils/constants/resources";
import actions from "@/utils/constants/actions";
import { Shareholder } from "@/types/shareholder";
import { ChartOfAccountRef } from "@/types/orders";
import { Badge, Button, Progress, Table } from "@mantine/core";
import JournalEntryLink from "@/components/global/journal-entry-link";
import { outlineIcons, solidIcons } from "@/components/icons";
import ShareholderModal from "./shareholder-modal";
import AddContributionModal from "./add-contribution-modal";

const accountText = (account?: ChartOfAccountRef | string | null) => (account && typeof account !== "string" ? `${account.code} - ${account.name}` : "-");

// Expandable shareholder card (brief section 6: "shareholder number and name, personal
// information, ownership percentage, allocated capital amount, total paid, remaining unpaid,
// payment progress indicator" + an inline Payments area) - collapsed by default so a capital
// structure with many shareholders stays scannable; everything else is one click away.
export default function ShareholderCard({ shareholder, onChanged }: { shareholder: Shareholder; onChanged: () => void }) {
  const { language, translate, translations } = useLanguage();
  const navigate = useNavigate();
  const canUpdate = useHasPermission(resources.shareholders, actions.update);
  const canCreate = useHasPermission(resources.shareholders, actions.create);

  const [expanded, setExpanded] = useState(false);
  const [editOpened, { open: openEdit, close: closeEdit }] = useDisclosure();
  const [paymentOpened, { open: openPayment, close: closePayment }] = useDisclosure();

  const money = (v: unknown) => formatAmount(v, translations.currency);
  const hasAllocation = typeof shareholder.allocatedCapital === "number" && shareholder.allocatedCapital > 0;
  const paidPct = hasAllocation ? Math.min(100, Math.round(((shareholder.shareCapital || 0) / shareholder.allocatedCapital!) * 1000) / 10) : 0;
  const contributions = [...shareholder.contributions].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-gray-100 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <button type="button" onClick={() => setExpanded((v) => !v)} className="flex w-full flex-wrap items-center justify-between gap-3 text-left">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100 text-sm font-semibold text-gray-600 dark:bg-gray-700 dark:text-gray-200">
            {shareholder.shareholderNumber}
          </span>
          <div className="flex min-w-0 flex-col">
            <span className="truncate font-medium text-gray-800 dark:text-gray-100">{shareholder.name}</span>
            {shareholder.nameAr && (
              <span className="truncate text-xs text-gray-400" dir="rtl">
                {shareholder.nameAr}
              </span>
            )}
          </div>
          <Badge color={shareholder.status === "active" ? "green" : "gray"} variant="light">
            {shareholder.status === "active" ? translate("Active", "نشط") : translate("Inactive", "غير نشط")}
          </Badge>
        </div>
        <div className="flex items-center gap-4">
          <div className="hidden flex-col items-end sm:flex">
            <span className="text-xs text-gray-400">{translate("Ownership", "الملكية")}</span>
            <span className="font-semibold tabular-nums text-gray-700 dark:text-gray-200">{shareholder.ownershipPercentage}%</span>
          </div>
          <div className="hidden flex-col items-end md:flex">
            <span className="text-xs text-gray-400">{translate("Remaining unpaid", "المتبقي")}</span>
            <span className="font-semibold tabular-nums text-gray-700 dark:text-gray-200">{hasAllocation ? money(shareholder.remainingUnpaid) : "-"}</span>
          </div>
          <solidIcons.AngleDown style={{ transform: expanded ? "rotate(180deg)" : undefined, transition: "transform 150ms" }} />
        </div>
      </button>

      {hasAllocation && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
            <span>
              {money(shareholder.shareCapital)} / {money(shareholder.allocatedCapital)}
            </span>
            <span className="tabular-nums">{paidPct}%</span>
          </div>
          <Progress value={paidPct} color="teal" size="xs" radius="xl" />
        </div>
      )}

      {expanded && (
        <div className="flex flex-col gap-4 border-t border-gray-50 pt-3 dark:border-gray-700">
          <div className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
            <InfoRow label={translate("Address", "العنوان")} value={shareholder.address || "-"} />
            <InfoRow label={translate("National ID", "الرقم القومي")} value={shareholder.nationalId || "-"} />
            <InfoRow label={translate("Phone", "الهاتف")} value={shareholder.phone || "-"} />
            <InfoRow label={translate("Email", "البريد الإلكتروني")} value={shareholder.email || "-"} />
            <InfoRow label={translate("Equity Account", "حساب حقوق الملكية")} value={accountText(shareholder.equityAccount)} />
            <InfoRow label={translate("Allocated Capital", "رأس المال المخصص")} value={hasAllocation ? money(shareholder.allocatedCapital) : "-"} />
          </div>

          <div className="flex items-center justify-between">
            <h5 className="text-sm font-semibold text-gray-700 dark:text-gray-200">{translate("Payments", "المدفوعات")}</h5>
            <div className="flex gap-2">
              {canUpdate && (
                <Button variant="subtle" size="xs" onClick={openEdit} data-no-row-click>
                  {translate("Edit", "تعديل")}
                </Button>
              )}
              <Button variant="subtle" size="xs" color="gray" onClick={() => navigate(`/${paths.admin}/${paths.shareholders}/${shareholder._id}`)} data-no-row-click>
                {translate("Open full page", "فتح الصفحة الكاملة")}
              </Button>
              {canCreate && shareholder.status === "active" && (
                <Button variant="light" size="xs" color="teal" onClick={openPayment} leftSection={<solidIcons.Plus size={11} />} data-no-row-click>
                  {translate("Add Payment", "إضافة دفعة")}
                </Button>
              )}
            </div>
          </div>

          {contributions.length === 0 ? (
            <p className="text-sm text-gray-400">{translate("No payments recorded yet.", "لم يتم تسجيل أي مدفوعات بعد.")}</p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-gray-100 dark:border-gray-700">
              <Table striped withColumnBorders className="text-sm">
                <Table.Thead className="bg-gray-50 dark:bg-gray-900">
                  <Table.Tr>
                    <Table.Th>{translate("Date", "التاريخ")}</Table.Th>
                    <Table.Th>{translate("Amount", "المبلغ")}</Table.Th>
                    <Table.Th>{translate("Received Into", "تم الاستلام في")}</Table.Th>
                    <Table.Th>{translate("Journal Entry", "القيد")}</Table.Th>
                    <Table.Th>{translate("Status", "الحالة")}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {contributions.map((c) => (
                    <Table.Tr key={c._id}>
                      <Table.Td>{formatDate(c.date, language)}</Table.Td>
                      <Table.Td className="tabular-nums">{money(c.amount)}</Table.Td>
                      <Table.Td>{accountText(c.paymentAccount)}</Table.Td>
                      <Table.Td>
                        <JournalEntryLink entry={c.journalEntry} />
                      </Table.Td>
                      <Table.Td>
                        <Badge size="sm" color="teal" variant="light" leftSection={<outlineIcons.CheckCircle size={10} />}>
                          {translate("Posted", "مرحّل")}
                        </Badge>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </div>
          )}
        </div>
      )}

      <ShareholderModal opened={editOpened} close={closeEdit} shareholder={shareholder} onSaved={onChanged} />
      <AddContributionModal opened={paymentOpened} close={closePayment} shareholder={shareholder} onSaved={onChanged} />
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-gray-50 py-1 last:border-0 dark:border-gray-700/60">
      <span className="text-gray-500 dark:text-gray-400">{label}</span>
      <span className="font-medium text-gray-700 dark:text-gray-200">{value}</span>
    </div>
  );
}
