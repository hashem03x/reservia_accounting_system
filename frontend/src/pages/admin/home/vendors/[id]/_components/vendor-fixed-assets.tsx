import { Link } from "react-router-dom";
import { Badge, Table } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import { formatDate } from "@/utils/helpers/date-formaters";
import { formatAmount } from "@/utils/helpers/format-amount";
import paths from "@/utils/constants/paths";
import JournalEntryLink from "@/components/global/journal-entry-link";
import { VendorFixedAssetAcquisition } from "@/types/fixed-asset";

const STATUS_COLORS = { unpaid: "red", partially_paid: "yellow", paid: "green", not_applicable: "gray" } as const;

/**
 * Fixed assets acquired from the vendor: amount owed (the acquisition entry's credit to the vendor),
 * paid and outstanding from the ledger, with links to the asset, its acquisition entry and each
 * payment entry.
 */
export default function VendorFixedAssets({ acquisitions }: { acquisitions: VendorFixedAssetAcquisition[] }) {
  const { language, translate, translations } = useLanguage();
  const money = (value: unknown) => formatAmount(value, translations.currency);
  const statusLabel = {
    unpaid: translate("Unpaid", "غير مدفوع"),
    partially_paid: translate("Partially Paid", "مدفوع جزئياً"),
    paid: translate("Fully Paid", "مدفوع بالكامل"),
    not_applicable: translate("No payable", "لا يوجد مستحق"),
  };

  return (
    <div className="flex flex-col gap-3">
      <h4>{translate("Fixed Asset Acquisitions", "اقتناء أصول ثابتة")}</h4>
      <div className="overflow-x-auto rounded-lg bg-white p-1.5 dark:bg-gray-800">
        <Table className="text-nowrap text-sm" withColumnBorders verticalSpacing="xs">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{translate("Date", "التاريخ")}</Table.Th>
              <Table.Th>{translate("Asset No.", "رقم الأصل")}</Table.Th>
              <Table.Th>{translate("Asset", "الأصل")}</Table.Th>
              <Table.Th>{translate("Project", "المشروع")}</Table.Th>
              <Table.Th className="text-end">{translate("Acquisition Amount", "قيمة الاقتناء")}</Table.Th>
              <Table.Th>{translate("Currency", "العملة")}</Table.Th>
              <Table.Th className="text-end">{translate("Paid", "المدفوع")}</Table.Th>
              <Table.Th className="text-end">{translate("Outstanding", "المتبقي")}</Table.Th>
              <Table.Th>{translate("Status", "الحالة")}</Table.Th>
              <Table.Th>{translate("Acquisition Entry", "قيد الاقتناء")}</Table.Th>
              <Table.Th>{translate("Payments", "المدفوعات")}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {acquisitions.map((a) => (
              <Table.Tr key={a._id}>
                <Table.Td>{a.acquisitionDate ? formatDate(a.acquisitionDate, language) : "-"}</Table.Td>
                <Table.Td className="tabular-nums">{a.assetNumber || "-"}</Table.Td>
                <Table.Td className="max-w-[220px] truncate">
                  <Link className="text-blue-600 hover:underline" to={`/${paths.admin}/${paths.fixedAssets}/${a._id}`}>
                    {a.name}
                  </Link>
                </Table.Td>
                <Table.Td>{a.projectNumber || "-"}</Table.Td>
                <Table.Td className="text-end tabular-nums">
                  {a.acquisitionAmount === null ? translate("n/a", "غير متاح") : money(a.acquisitionAmount)}
                </Table.Td>
                <Table.Td>{a.currency}</Table.Td>
                <Table.Td className="text-end tabular-nums">{money(a.totalPaid)}</Table.Td>
                <Table.Td className="text-end tabular-nums">
                  {a.outstanding === null ? translate("n/a", "غير متاح") : money(a.outstanding)}
                </Table.Td>
                <Table.Td>
                  <Badge color={STATUS_COLORS[a.status]} variant="light" title={a.review || undefined}>
                    {statusLabel[a.status]}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <JournalEntryLink entry={a.acquisitionJournalEntry} />
                </Table.Td>
                <Table.Td className="whitespace-normal">
                  {a.payments.length === 0
                    ? "-"
                    : a.payments.map((p, i) => (
                        <span
                          key={i}
                          className={`me-2 inline-flex gap-1 ${p.status === "reversed" ? "text-gray-400 line-through" : ""}`}
                        >
                          <JournalEntryLink entry={p.journalEntry} />
                          <span className="tabular-nums">{money(p.amount)}</span>
                          {p.reference && <span className="text-gray-500">({p.reference})</span>}
                        </span>
                      ))}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </div>
    </div>
  );
}
