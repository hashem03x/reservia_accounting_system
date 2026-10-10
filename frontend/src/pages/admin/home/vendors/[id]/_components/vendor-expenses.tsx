import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Badge, Select, Table, TextInput } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { formatDate } from "@/utils/helpers/date-formaters";
import paths from "@/utils/constants/paths";
import JournalEntryLink from "@/components/global/journal-entry-link";
import { VendorExpenses as VendorExpensesData, VendorExpenseStatus } from "@/types/purchase-order-extras";

const STATUS_COLORS: Record<VendorExpenseStatus, string> = {
  unpaid: "red",
  partially_paid: "yellow",
  paid: "green",
  cancelled: "gray",
};

/**
 * The vendor's expenses (backend: vendors/:id/expenses): amount, VAT, total, paid (payments whose
 * entry still stands) and outstanding, with totals for the filters. Loads on its own - a failure here
 * shows an error in this section only.
 */
export default function VendorExpenses({ vendorId }: { vendorId: string }) {
  const { language, translate, translations } = useLanguage();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [status, setStatus] = useState("");
  const { privateRequest, loading, setLoading, error, setError, data, setData } = useDataHandler<VendorExpensesData | null>({
    initialData: null,
    initialLoading: true,
  });

  useEffect(() => {
    const controller = new AbortController();
    const canceled = { current: false };
    handleRequest(
      language,
      setLoading,
      setError,
      async () => {
        const res = await privateRequest({
          url: `vendors/${vendorId}/expenses`,
          params: { ...(from ? { from } : {}), ...(to ? { to } : {}), ...(status ? { status } : {}) },
          signal: controller.signal,
          language,
        });
        setData(res.data);
      },
      canceled,
    );
    return () => {
      controller.abort();
      canceled.current = true;
    };
  }, [vendorId, from, to, status]);

  const money = (n: number) => `${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const statusLabel: Record<VendorExpenseStatus, string> = {
    unpaid: translate("Unpaid", "غير مدفوع"),
    partially_paid: translate("Partially Paid", "مدفوع جزئياً"),
    paid: translate("Paid", "مدفوع"),
    cancelled: translate("Cancelled (entry reversed)", "ملغي (القيد معكوس)"),
  };

  return (
    <div className="flex flex-col gap-3" data-tour="vendor-expenses">
      <h4>{translate("Expenses", "المصروفات")}</h4>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <TextInput type="date" label={translate("From", "من")} value={from} onChange={(e) => setFrom(e.target.value)} />
        <TextInput type="date" label={translate("To", "إلى")} value={to} onChange={(e) => setTo(e.target.value)} />
        <Select
          label={translate("Payment Status", "حالة الدفع")}
          placeholder={translate("All", "الكل")}
          value={status || null}
          onChange={(v) => setStatus(v || "")}
          data={(Object.keys(statusLabel) as VendorExpenseStatus[]).map((k) => ({ value: k, label: statusLabel[k] }))}
          clearable
        />
      </div>
      {error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : loading && !data ? (
        <p className="text-sm text-gray-400">{translate("Loading expenses...", "جاري تحميل المصروفات...")}</p>
      ) : !data || data.expenses.length === 0 ? (
        <p className="text-sm text-gray-500">
          {translate("No expenses for this vendor and filters.", "لا توجد مصروفات لهذا المورد بهذه الفلاتر.")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg bg-white p-1.5 dark:bg-gray-800">
          <Table className="text-nowrap text-sm" withColumnBorders verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{translate("Date", "التاريخ")}</Table.Th>
                <Table.Th>{translate("Reference", "المرجع")}</Table.Th>
                <Table.Th>{translate("Category", "التصنيف")}</Table.Th>
                <Table.Th>{translate("Expense Account", "حساب المصروف")}</Table.Th>
                <Table.Th>{translate("Description", "البيان")}</Table.Th>
                <Table.Th>{translate("Currency", "العملة")}</Table.Th>
                <Table.Th className="text-end">{translate("Amount", "المبلغ")}</Table.Th>
                <Table.Th className="text-end">{translate("VAT", "الضريبة")}</Table.Th>
                <Table.Th className="text-end">{translate("Total", "الإجمالي")}</Table.Th>
                <Table.Th className="text-end">{translate("Paid", "المدفوع")}</Table.Th>
                <Table.Th className="text-end">{translate("Outstanding", "المتبقي")}</Table.Th>
                <Table.Th>{translate("Status", "الحالة")}</Table.Th>
                <Table.Th>{translate("Journal Entry", "القيد")}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data.expenses.map((e) => (
                <Table.Tr key={e._id} className={e.paymentStatus === "cancelled" ? "text-gray-400" : ""}>
                  <Table.Td>{formatDate(e.date, language)}</Table.Td>
                  <Table.Td className="max-w-[160px] truncate">
                    <Link
                      className="text-blue-600 hover:underline"
                      to={`/${paths.admin}/${paths.home}/${paths.expenses}/${e._id}`}
                    >
                      {e.reference || translate("Open", "فتح")}
                    </Link>
                  </Table.Td>
                  <Table.Td className="max-w-[140px] truncate">
                    {e.category ? (language === "ar-EG" && e.category.nameAr) || e.category.name : "-"}
                  </Table.Td>
                  <Table.Td className="max-w-[180px] truncate">
                    {e.expenseAccount ? `${e.expenseAccount.code} - ${e.expenseAccount.name}` : "-"}
                  </Table.Td>
                  <Table.Td className="max-w-[200px] truncate" title={e.description || undefined}>
                    {e.description || "-"}
                  </Table.Td>
                  <Table.Td>{e.currency}</Table.Td>
                  <Table.Td className="text-end tabular-nums">{money(e.amount)}</Table.Td>
                  <Table.Td className="text-end tabular-nums">{money(e.vat)}</Table.Td>
                  <Table.Td className="text-end tabular-nums">{money(e.total)}</Table.Td>
                  <Table.Td className="text-end tabular-nums">{money(e.paid)}</Table.Td>
                  <Table.Td className="text-end tabular-nums">{money(e.outstanding)}</Table.Td>
                  <Table.Td>
                    <Badge color={STATUS_COLORS[e.paymentStatus]} variant="light">
                      {statusLabel[e.paymentStatus]}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <JournalEntryLink entry={e.journalEntry} />
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
            <Table.Tfoot className="font-semibold">
              <Table.Tr>
                <Table.Td colSpan={6}>
                  {translate(
                    `Total (${data.totals.count} expenses${data.totals.cancelled ? `, ${data.totals.cancelled} cancelled not counted` : ""})`,
                    `الإجمالي (${data.totals.count} مصروف${data.totals.cancelled ? `، ${data.totals.cancelled} ملغي غير محتسب` : ""})`,
                  )}
                </Table.Td>
                <Table.Td className="text-end tabular-nums">{money(data.totals.amount)}</Table.Td>
                <Table.Td className="text-end tabular-nums">{money(data.totals.vat)}</Table.Td>
                <Table.Td className="text-end tabular-nums">{money(data.totals.total)}</Table.Td>
                <Table.Td className="text-end tabular-nums">{money(data.totals.paid)}</Table.Td>
                <Table.Td className="text-end tabular-nums">{money(data.totals.outstanding)}</Table.Td>
                <Table.Td colSpan={2}>{translations.currency}</Table.Td>
              </Table.Tr>
            </Table.Tfoot>
          </Table>
        </div>
      )}
    </div>
  );
}
