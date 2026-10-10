import { useEffect } from "react";
import { useDisclosure } from "@mantine/hooks";
import { Alert, Badge, Button, Table } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { formatDateAndTime } from "@/utils/helpers/date-formaters";
import { getPaymentMethodLabel } from "@/utils/constants/payment-methods";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import ErrorAlert from "@/components/ui/error-alert";
import JournalEntryLink from "@/components/global/journal-entry-link";
import { solidIcons } from "@/components/icons";
import { PaymentMethod } from "@/types/payment";
import { PurchaseOrderPayments, PurchaseOrderPaymentStatus } from "@/types/purchase-order-extras";
import { useOrder } from "../../../context";
import AddPaymentModal from "./_components/add-payment-modal";

const STATUS_COLORS: Record<PurchaseOrderPaymentStatus, string> = {
  unpaid: "red",
  partially_paid: "yellow",
  paid: "green",
  overpaid: "blue",
};

/**
 * The order's payment position from the backend (purchaseOrderPaymentService): what is owed, what was
 * paid (payments whose journal entry still stands, net of refunds), what is outstanding, and every
 * payment with its entry - reversed payments stay listed but do not count.
 */
export default function Payment() {
  const { translate, language, translations } = useLanguage();
  const { order, payments } = useOrder();
  const [opened, { open, close }] = useDisclosure(false);
  const { privateRequest, loading, setLoading, error, setError, data, setData } =
    useDataHandler<PurchaseOrderPayments | null>({ initialData: null, initialLoading: true });

  function load() {
    handleRequest(language, setLoading, setError, async () => {
      const res = await privateRequest({ url: `purchaseOrder/${order._id}/payments`, language });
      setData(res.data);
    });
  }
  useEffect(() => {
    load();
  }, [order._id, payments.length, order.paidAmount]);

  const money = (n: number) =>
    `${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${translations.currency}`;
  const statusLabel: Record<PurchaseOrderPaymentStatus, string> = {
    unpaid: translate("Unpaid", "غير مدفوع"),
    partially_paid: translate("Partially Paid", "مدفوع جزئياً"),
    paid: translate("Paid", "مدفوع"),
    overpaid: translate("Overpaid (credit balance)", "مدفوع بالزيادة (رصيد دائن)"),
  };
  const s = data?.summary;
  const lines: [string, string, boolean?][] = s
    ? [
        [translate("Subtotal before discounts", "الإجمالي قبل الخصومات"), money(s.grossBeforeDiscount)],
        [translate("Discounts", "الخصومات"), money(-s.discounts)],
        [translate("Returns", "المرتجعات"), money(-s.returns)],
        [translate("Subtotal before tax", "الإجمالي قبل الضريبة"), money(s.subtotal), true],
        [`${translate("VAT", "ضريبة القيمة المضافة")} (${s.vatPercentage}%)`, money(s.vat)],
        [
          `${translate("Withholding tax (paid to the Tax Authority)", "ضريبة الخصم (تُدفع لمصلحة الضرائب)")} (${s.withholdingPercentage}%)`,
          money(-s.withholding),
        ],
        [translate("Total PO amount (payable to the vendor)", "إجمالي أمر الشراء (المستحق للمورد)"), money(s.total), true],
        [translate("Total paid", "إجمالي المدفوع"), money(s.totalPaid), true],
        ...(s.refunded > 0
          ? ([[translate("of which refunds received", "منها مبالغ مستردة"), money(-s.refunded)]] as [string, string][])
          : []),
        [translate("Outstanding payable", "المستحق المتبقي"), money(s.outstanding), true],
        ...(s.creditBalance > 0
          ? ([[translate("Credit balance (overpaid)", "رصيد دائن (مدفوع بالزيادة)"), money(s.creditBalance)]] as [
              string,
              string,
            ][])
          : []),
      ]
    : [];

  return (
    <AdminLayoutBox header={{ title: translate("Payments", "الدفعات") }}>
      <div className="flex flex-col gap-6">
        {error && <ErrorAlert error={error} />}
        {loading && !data ? (
          <p className="text-sm text-gray-400">{translate("Loading...", "جاري التحميل...")}</p>
        ) : (
          s && (
            <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="rounded-md border p-3 dark:border-gray-700">
                <div className="mb-2 flex items-center justify-between">
                  <h4>{translate("Financial Summary", "الملخص المالي")}</h4>
                  <Badge color={STATUS_COLORS[s.status]} variant="light" size="lg">
                    {statusLabel[s.status]}
                  </Badge>
                </div>
                <dl className="flex flex-col gap-1 text-sm">
                  {lines.map(([label, value, strong]) => (
                    <div
                      key={label}
                      className={`flex justify-between gap-4 ${strong ? "border-t pt-1 font-semibold dark:border-gray-700" : "text-gray-600 dark:text-gray-300"}`}
                    >
                      <dt>{label}</dt>
                      <dd className="tabular-nums">{value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
              <div className="flex flex-col gap-2 text-sm text-gray-600 dark:text-gray-300">
                <p>
                  {translate(
                    "Total paid counts the payments whose journal entry still stands (a reversed payment is listed but not counted), plus an Advanced Payment applied when the order was created, less refunds received on returns. Each payment belongs to this order only, so its full amount is allocated here; there are no unapplied payments.",
                    "إجمالي المدفوع يشمل الدفعات التي ما زال قيدها قائماً (الدفعة المعكوسة تظهر ولا تُحتسب)، والدفعة المقدمة المطبقة عند إنشاء الأمر، ناقص المبالغ المستردة عن المرتجعات. كل دفعة تخص هذا الأمر فقط فيُخصص مبلغها كاملاً له؛ ولا توجد دفعات غير مخصصة.",
                  )}
                </p>
                {Math.abs(s.storedPaidAmount - s.totalPaid) > 0.005 && (
                  <Alert color="yellow" variant="light">
                    {translate(
                      `The order record shows ${money(s.storedPaidAmount)} paid - a payment was reversed before reversals updated orders. The figures here follow the journal entries.`,
                      `سجل الأمر يُظهر ${money(s.storedPaidAmount)} مدفوعاً - عُكست دفعة قبل أن تحدّث القيود العكسية الأوامر. الأرقام هنا تتبع القيود.`,
                    )}
                  </Alert>
                )}
              </div>
            </section>
          )
        )}

        <hr />

        <section className="flex flex-col gap-1.5">
          <h4>{translate("Payment Transaction History", "سجل معاملات الدفع")}</h4>
          {!data || data.payments.length === 0 ? (
            <p>{translate("No payments have been made yet.", "لم يتم اصدار دفعات حتى الآن.")}</p>
          ) : (
            <div className="overflow-x-auto rounded-md border dark:border-gray-700">
              <Table className="text-nowrap text-sm" withColumnBorders verticalSpacing="xs">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{translate("Date", "التاريخ")}</Table.Th>
                    <Table.Th>{translate("Type", "النوع")}</Table.Th>
                    <Table.Th>{translate("Reference", "المرجع")}</Table.Th>
                    <Table.Th>{translate("Method / Account", "الطريقة / الحساب")}</Table.Th>
                    <Table.Th>{translate("Currency", "العملة")}</Table.Th>
                    <Table.Th className="text-end">{translate("Amount", "المبلغ")}</Table.Th>
                    <Table.Th className="text-end">{translate("Allocated to this PO", "المخصص لهذا الأمر")}</Table.Th>
                    <Table.Th>{translate("Status", "الحالة")}</Table.Th>
                    <Table.Th>{translate("Journal Entry", "القيد")}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {data.payments.map((p) => (
                    <Table.Tr key={p._id} className={p.status === "reversed" ? "text-gray-400 line-through" : ""}>
                      <Table.Td>{formatDateAndTime(p.date, language)}</Table.Td>
                      <Table.Td>
                        {p.kind === "refund"
                          ? translate("Refund", "استرداد")
                          : p.kind === "advance"
                            ? translate("Advanced Payment", "دفعة مقدمة")
                            : translate("Payment", "دفعة")}
                      </Table.Td>
                      <Table.Td className="max-w-[200px] truncate" title={p.reference || undefined}>
                        {p.reference || "-"}
                      </Table.Td>
                      <Table.Td>
                        {p.paymentAccount
                          ? `${p.paymentAccount.code} - ${(language === "ar-EG" && p.paymentAccount.nameAr) || p.paymentAccount.name}`
                          : p.method === "advanced_payment"
                            ? translate("Advanced Payment", "دفعة مقدمة")
                            : getPaymentMethodLabel(p.paymentMethod as PaymentMethod | null, language)}
                      </Table.Td>
                      <Table.Td>{p.currency}</Table.Td>
                      <Table.Td className="text-end tabular-nums">
                        {money(p.kind === "refund" ? -p.amount : p.amount)}
                      </Table.Td>
                      <Table.Td className="text-end tabular-nums">
                        {money(p.kind === "refund" ? -p.allocated : p.allocated)}
                      </Table.Td>
                      <Table.Td className="no-underline">
                        <Badge
                          color={p.status === "reversed" ? "gray" : p.status === "posted" ? "green" : "blue"}
                          variant="light"
                        >
                          {p.status === "reversed"
                            ? translate("Reversed", "معكوسة")
                            : p.status === "posted"
                              ? translate("Posted", "مرحلة")
                              : translate("Recorded (no entry)", "مسجلة (بدون قيد)")}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <JournalEntryLink entry={p.journalEntry} />
                        {p.reversalEntry && (
                          <span className="ms-1 text-xs">
                            ({translate("reversed by", "معكوسة بـ")} <JournalEntryLink entry={p.reversalEntry} />)
                          </span>
                        )}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </div>
          )}

          <div className="mt-1.5">
            {(s ? s.outstanding > 0 : order.remainingAmount !== 0) && (
              <Button onClick={open} radius="md" leftSection={<solidIcons.Plus />}>
                {translate("Add Payment", "اضافة دفعة")}
              </Button>
            )}

            <AddPaymentModal opened={opened} close={close} />
          </div>
        </section>
      </div>
    </AdminLayoutBox>
  );
}
