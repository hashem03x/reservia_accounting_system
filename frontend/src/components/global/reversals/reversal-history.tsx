import { useCallback, useEffect, useState } from "react";
import { Badge, Table } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import handleRequest from "@/utils/helpers/handle-request";
import { formatDateAndTime } from "@/utils/helpers/date-formaters";
import JournalEntryLink from "@/components/global/journal-entry-link";
import ErrorAlert from "@/components/ui/error-alert";
import { AccountingReversal } from "@/types/reversal";

const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * The reversals (returns, payment and settlement reversals) of one document, newest first, with the
 * original and the compensating journal entries. `refreshKey` reloads it after a new reversal.
 */
export default function ReversalHistory({ query, refreshKey = 0 }: { query: Record<string, string>; refreshKey?: number }) {
  const { translate, language } = useLanguage();
  const privateRequest = usePrivateRequest();
  const [rows, setRows] = useState<AccountingReversal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(
    () =>
      handleRequest(language, setLoading, setError, async () => {
        const res = await privateRequest({ url: "reversals", params: query, language });
        setRows(res.data || []);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(query), language],
  );
  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const typeLabel = (r: AccountingReversal) =>
    ({
      sales_return: r.scope === "full" ? translate("Full return", "مرتجع كامل") : translate("Partial return", "مرتجع جزئي"),
      purchase_return:
        r.scope === "full" ? translate("Full return", "مرتجع كامل") : translate("Partial return", "مرتجع جزئي"),
      payment: translate("Payment reversed", "عكس دفعة"),
      settlement: translate("Settlement reversed", "عكس تسوية"),
    })[r.type];

  if (error) return <ErrorAlert error={error} />;
  if (loading && !rows.length) return null;
  return (
    <section className="flex flex-col gap-2">
      <h4>{translate("Reversal history", "سجل العكس")}</h4>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-500">
          {translate("Nothing has been returned or reversed.", "لم يتم إرجاع أو عكس أي شيء.")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-gray-100">
          <Table className="text-sm" verticalSpacing="xs">
            <Table.Thead className="bg-gray-50">
              <Table.Tr>
                <Table.Th>{translate("Date", "التاريخ")}</Table.Th>
                <Table.Th>{translate("Type", "النوع")}</Table.Th>
                <Table.Th className="text-end">{translate("Amount", "المبلغ")}</Table.Th>
                <Table.Th>{translate("Reason", "السبب")}</Table.Th>
                <Table.Th>{translate("Original entries", "القيود الأصلية")}</Table.Th>
                <Table.Th>{translate("Reversal entries", "قيود العكس")}</Table.Th>
                <Table.Th>{translate("By", "بواسطة")}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((r) => (
                <Table.Tr key={r._id}>
                  <Table.Td className="whitespace-nowrap">{formatDateAndTime(r.createdAt, language)}</Table.Td>
                  <Table.Td>
                    <Badge color={r.type.endsWith("return") ? "orange" : "grape"} variant="light">
                      {typeLabel(r)}
                    </Badge>
                  </Table.Td>
                  <Table.Td className="whitespace-nowrap text-end tabular-nums">
                    {money(r.amount)}
                    {r.refundAmount ? (
                      <div className="text-xs text-gray-500">
                        {translate(`refunded ${money(r.refundAmount)}`, `مردود ${money(r.refundAmount)}`)}
                      </div>
                    ) : null}
                  </Table.Td>
                  <Table.Td className="max-w-[260px]">
                    <span className="block truncate" title={r.reason}>
                      {r.reason}
                    </span>
                    {r.notes?.length ? (
                      <span className="block truncate text-xs text-gray-500" title={r.notes.join(" ")}>
                        {r.notes.join(" ")}
                      </span>
                    ) : null}
                  </Table.Td>
                  <Table.Td>
                    <div className="flex flex-wrap gap-1.5">
                      {r.originalEntries.length
                        ? r.originalEntries.map((e) => <JournalEntryLink key={e._id} entry={e} />)
                        : "-"}
                    </div>
                  </Table.Td>
                  <Table.Td>
                    <div className="flex flex-wrap gap-1.5">
                      {r.reversalEntries.length
                        ? r.reversalEntries.map((e) => <JournalEntryLink key={e._id} entry={e} />)
                        : "-"}
                    </div>
                  </Table.Td>
                  <Table.Td>{r.createdBy?.name || "-"}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </div>
      )}
    </section>
  );
}
