import { useEffect, useRef, useState } from "react";
import { Alert, Badge, Button, NumberInput, Select, Table, TextInput, Textarea } from "@mantine/core";
import { DateInput } from "@mantine/dates";
import { useDisclosure } from "@mantine/hooks";
import { useLanguage } from "@/context/LanguageContext";
import { useWarehouses } from "@/context/WarehousesContext";
import useDataHandler from "@/hooks/useDataHandler";
import useHasPermission from "@/hooks/useHasPermission";
import useWarehouseHelpers from "@/hooks/useWarehouseHelpers";
import handleRequest from "@/utils/helpers/handle-request";
import { formatDate } from "@/utils/helpers/date-formaters";
import { formatAmount } from "@/utils/helpers/format-amount";
import { toDateOnly } from "@/utils/helpers/format-date";
import resources from "@/utils/constants/resources";
import actions from "@/utils/constants/actions";
import Modal from "@/components/ui/modal";
import ErrorAlert from "@/components/ui/error-alert";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import { DataTable, DataTableContainer, dataTableHeadClassName } from "@/components/ui/data-table";
import JournalEntryLink from "@/components/global/journal-entry-link";
import PaymentAccountSelect from "@/components/global/payment-account-select";
import ReverseJournalEntryModal from "@/pages/admin/journal-entries/_components/reverse-journal-entry-modal";
import {
  FixedAsset,
  FixedAssetPaymentRow,
  FixedAssetPayments,
  FixedAssetPaymentRowStatus,
  FixedAssetPaymentStatus,
} from "@/types/fixed-asset";
import { JournalEntry } from "@/types/journal-entry";

const STATUS_COLORS: Record<FixedAssetPaymentStatus, string> = {
  unpaid: "red",
  partially_paid: "yellow",
  paid: "green",
  not_applicable: "gray",
};
const ROW_STATUS_COLORS: Record<FixedAssetPaymentRowStatus, string> = {
  posted: "green",
  reversed: "gray",
  missing_entry: "red",
};

// A new key per payment form: a double click or a retried request with the same key records the
// payment once (the server returns the payment already recorded).
const newRequestKey = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/**
 * The asset's Payments tab: what is owed to the vendor (from the acquisition entry), what has been
 * paid (posted payment entries only), the payment history, and Record Payment.
 */
export default function FixedAssetPaymentsTab({ asset }: { asset: FixedAsset }) {
  const { language, translate, translations } = useLanguage();
  const canPay = useHasPermission(resources.expenses, actions.create);
  const canReverse = useHasPermission(resources.journalEntries, actions.update);
  const money = (value: unknown) => formatAmount(value, translations.currency);

  const { privateRequest, loading, setLoading, error, setError, data, setData } = useDataHandler<FixedAssetPayments | null>({
    initialData: null,
    initialLoading: true,
  });
  function load() {
    handleRequest(language, setLoading, setError, async () => {
      const res = await privateRequest({ url: `fixed-assets/${asset._id}/payments`, language });
      setData(res.data);
    });
  }
  useEffect(() => {
    load();
  }, [asset._id]);

  const [payOpened, { open: openPay, close: closePay }] = useDisclosure();
  const [reversing, setReversing] = useState<FixedAssetPaymentRow | null>(null);

  const statusLabel: Record<FixedAssetPaymentStatus, string> = {
    unpaid: translate("Unpaid", "غير مدفوع"),
    partially_paid: translate("Partially Paid", "مدفوع جزئياً"),
    paid: translate("Fully Paid", "مدفوع بالكامل"),
    not_applicable: translate("No payable", "لا يوجد مستحق"),
  };
  const rowStatusLabel: Record<FixedAssetPaymentRowStatus, string> = {
    posted: translate("Posted", "مرحل"),
    reversed: translate("Reversed", "معكوس"),
    missing_entry: translate("Entry missing", "القيد غير موجود"),
  };

  if (loading && !data) return <LoadingSection message={translate("Loading payments...", "جاري تحميل المدفوعات...")} />;
  if (error && !data)
    return (
      <ErrorSection
        errorTitle={translate("Error loading payments", "خطأ في تحميل المدفوعات")}
        errorMessage={error}
        button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: load }}
      />
    );
  if (!data) return null;

  const { summary, payments } = data;
  const outstanding = summary.outstanding ?? 0;
  const payable = summary.payable !== null && summary.payable > 0;

  const cards: [string, React.ReactNode][] = [
    [translate("Acquisition Cost (excl. VAT)", "تكلفة الاقتناء (بدون الضريبة)"), money(summary.acquisitionCost)],
    [
      translate("Owed to Vendor (incl. VAT)", "المستحق للبائع (شامل الضريبة)"),
      summary.payable === null ? translate("n/a", "غير متاح") : money(summary.payable),
    ],
    [translate("Total Paid", "إجمالي المدفوع"), money(summary.totalPaid)],
    [
      translate("Outstanding", "المتبقي"),
      summary.outstanding === null ? translate("n/a", "غير متاح") : money(summary.outstanding),
    ],
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
          <Badge color={STATUS_COLORS[summary.status]} variant="light" size="lg">
            {statusLabel[summary.status]}
          </Badge>
          <span className="truncate">
            {data.asset.vendor
              ? `${data.asset.vendor.name}${data.asset.vendor.vendorNumber != null ? ` (${data.asset.vendor.vendorNumber})` : ""}`
              : translate("No vendor", "بدون بائع")}
          </span>
          {data.asset.acquisitionDate && <span>· {formatDate(data.asset.acquisitionDate, language)}</span>}
        </div>
        {canPay && (
          <Button
            onClick={openPay}
            disabled={!payable || outstanding <= 0}
            title={
              !payable
                ? summary.review || undefined
                : outstanding <= 0
                  ? translate("This asset is fully paid.", "هذا الأصل مدفوع بالكامل.")
                  : undefined
            }
          >
            {translate("Record Payment", "تسجيل دفعة")}
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map(([label, value]) => (
          <div key={label} className="rounded-lg border border-gray-100 p-3 dark:border-gray-700">
            <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
            <p className="mt-1 text-base font-semibold tabular-nums">{value}</p>
          </div>
        ))}
      </div>

      {summary.review && (
        <Alert color="yellow" variant="light" title={translate("Accounting review needed", "يحتاج مراجعة محاسبية")}>
          {summary.review}
        </Alert>
      )}
      {payable && outstanding <= 0 && (
        <Alert color="green" variant="light">
          {translate(
            "This asset is fully paid - no outstanding balance remains.",
            "هذا الأصل مدفوع بالكامل - لا يوجد رصيد متبقي.",
          )}
        </Alert>
      )}

      <div className="flex flex-col gap-2">
        <h4>{translate("Payment History", "سجل المدفوعات")}</h4>
        {payments.length === 0 ? (
          <p className="text-sm text-gray-400">
            {translate("No payments have been recorded for this asset yet.", "لم يتم تسجيل أي مدفوعات لهذا الأصل بعد.")}
          </p>
        ) : (
          <DataTableContainer>
            <DataTable className="text-sm">
              <Table.Thead className={dataTableHeadClassName}>
                <Table.Tr>
                  <Table.Th className="whitespace-nowrap">{translate("Date", "التاريخ")}</Table.Th>
                  <Table.Th className="whitespace-nowrap">{translate("Reference", "المرجع")}</Table.Th>
                  <Table.Th className="whitespace-nowrap text-end">{translate("Amount", "المبلغ")}</Table.Th>
                  <Table.Th className="whitespace-nowrap">{translate("Currency", "العملة")}</Table.Th>
                  <Table.Th className="whitespace-nowrap">{translate("Payment Method", "طريقة الدفع")}</Table.Th>
                  <Table.Th className="whitespace-nowrap">{translate("Vendor", "البائع")}</Table.Th>
                  <Table.Th className="whitespace-nowrap">{translate("Status", "الحالة")}</Table.Th>
                  <Table.Th className="whitespace-nowrap">{translate("Journal Entry", "القيد")}</Table.Th>
                  <Table.Th className="whitespace-nowrap">{translate("Description", "البيان")}</Table.Th>
                  <Table.Th className="whitespace-nowrap">{translate("Created By", "بواسطة")}</Table.Th>
                  {canReverse && <Table.Th />}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {payments.map((p) => (
                  <Table.Tr
                    key={p._id}
                    className={p.status === "reversed" ? "text-gray-400 line-through decoration-gray-300" : ""}
                  >
                    <Table.Td className="whitespace-nowrap">{formatDate(p.date, language)}</Table.Td>
                    <Table.Td className="max-w-[160px] truncate" title={p.reference || undefined}>
                      {p.reference || "-"}
                    </Table.Td>
                    <Table.Td className="whitespace-nowrap text-end tabular-nums">{money(p.amount)}</Table.Td>
                    <Table.Td>{p.currency}</Table.Td>
                    <Table.Td className="max-w-[200px] truncate">
                      {p.paymentAccount
                        ? `${p.paymentAccount.code} - ${(language === "ar-EG" && p.paymentAccount.nameAr) || p.paymentAccount.name}`
                        : "-"}
                    </Table.Td>
                    <Table.Td className="max-w-[180px] truncate">{p.vendor?.name || "-"}</Table.Td>
                    <Table.Td className="whitespace-nowrap no-underline">
                      <Badge color={ROW_STATUS_COLORS[p.status]} variant="light" className="normal-case">
                        {rowStatusLabel[p.status]}
                      </Badge>
                    </Table.Td>
                    <Table.Td className="whitespace-nowrap">
                      <JournalEntryLink entry={p.journalEntry} />
                      {p.reversalEntry && (
                        <span className="ms-1 text-xs">
                          ({translate("reversed by", "معكوس بـ")} <JournalEntryLink entry={p.reversalEntry} />)
                        </span>
                      )}
                    </Table.Td>
                    <Table.Td className="max-w-[240px] truncate" title={p.notes || undefined}>
                      {p.notes || "-"}
                    </Table.Td>
                    <Table.Td className="whitespace-nowrap">{p.createdBy?.name || "-"}</Table.Td>
                    {canReverse && (
                      <Table.Td className="whitespace-nowrap">
                        {p.status === "posted" && typeof p.journalEntry !== "string" && (
                          <Button size="compact-xs" variant="subtle" color="red" onClick={() => setReversing(p)}>
                            {translate("Reverse", "عكس")}
                          </Button>
                        )}
                      </Table.Td>
                    )}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </DataTable>
          </DataTableContainer>
        )}
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {translate(
            "Each payment posts Dr Suppliers (the vendor) / Cr the payment account. Reversed payments stay in the history but are not counted as paid.",
            "كل دفعة ترحّل مدين الموردين (البائع) / دائن حساب الدفع. الدفعات المعكوسة تبقى في السجل لكنها لا تُحسب ضمن المدفوع.",
          )}
        </p>
      </div>

      <RecordPaymentModal
        opened={payOpened}
        close={closePay}
        assetId={asset._id}
        vendorId={data.asset.vendor?._id}
        outstanding={outstanding}
        minDate={data.asset.acquisitionDate}
        onPaid={setData}
      />
      {reversing && typeof reversing.journalEntry !== "string" && (
        <ReverseJournalEntryModal
          opened={!!reversing}
          close={() => setReversing(null)}
          entry={
            {
              _id: reversing.journalEntry._id,
              entryNumber: reversing.journalEntry.entryNumber,
              date: reversing.date,
              totalDebit: reversing.amount,
            } as JournalEntry
          }
          onReversed={() => load()}
        />
      )}
    </div>
  );
}

// Dr Suppliers (vendor) / Cr the selected Cash or Cash Equivalent account - never more than is owed.
function RecordPaymentModal({
  opened,
  close,
  assetId,
  vendorId,
  outstanding,
  minDate,
  onPaid,
}: {
  opened: boolean;
  close: () => void;
  assetId: string;
  vendorId?: string;
  outstanding: number;
  minDate?: string;
  onPaid: (data: FixedAssetPayments) => void;
}) {
  const { language, translate, translations } = useLanguage();
  const { data: warehouses } = useWarehouses();
  const { updateWarehouseBalanceById } = useWarehouseHelpers();
  const [amount, setAmount] = useState<string | number>(outstanding);
  const [paymentAccount, setPaymentAccount] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [date, setDate] = useState<Date | null>(new Date());
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const requestKey = useRef(newRequestKey());
  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  useEffect(() => {
    if (opened) {
      setAmount(outstanding);
      setError("");
    }
  }, [opened]);

  const value = typeof amount === "number" ? amount : 0;
  const earliest = minDate ? new Date(`${minDate.slice(0, 10)}T00:00:00`) : undefined;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    handleRequest(language, setLoading, setError, async () => {
      const res = await privateRequest({
        language,
        method: "POST",
        url: `fixed-assets/${assetId}/payments`,
        data: {
          amount: value,
          paymentAccount,
          warehouseId,
          vendor: vendorId,
          date: date ? toDateOnly(date) : undefined,
          reference: reference || undefined,
          notes: notes || undefined,
          requestKey: requestKey.current,
        },
      });
      updateWarehouseBalanceById(warehouseId, value, "out");
      onPaid(res.data);
      close();
      // The form is only reset after a successful payment, so a failed one keeps what was entered.
      requestKey.current = newRequestKey();
      setPaymentAccount("");
      setWarehouseId("");
      setReference("");
      setNotes("");
    });
  }

  return (
    <Modal opened={opened} onClose={close} title={translate("Record Payment", "تسجيل دفعة")}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error && <ErrorAlert error={error} />}
        <NumberInput
          label={translate("Amount", "المبلغ")}
          description={`${translate("Outstanding", "المتبقي")}: ${outstanding.toLocaleString("en-US", { minimumFractionDigits: 2 })} ${translations.currency}`}
          value={amount}
          onChange={setAmount}
          min={0.01}
          max={outstanding}
          decimalScale={2}
          thousandSeparator
          error={value > outstanding ? translate("More than the outstanding amount", "أكبر من المبلغ المتبقي") : undefined}
          required
        />
        <DateInput
          label={translate("Payment Date", "تاريخ الدفع")}
          value={date}
          onChange={setDate}
          minDate={earliest}
          valueFormat="YYYY-MM-DD"
          required
        />
        <PaymentAccountSelect
          value={paymentAccount}
          onChange={setPaymentAccount}
          label={translate("Payment Method", "طريقة الدفع")}
          required
        />
        <Select
          label={translate("Warehouse", "الفرع")}
          placeholder={translate("Select warehouse", "اختر الفرع")}
          value={warehouseId || null}
          onChange={(v) => setWarehouseId(v || "")}
          data={warehouses.map((w) => ({ value: w._id, label: w.name }))}
          required
        />
        <TextInput
          label={translate("Currency", "العملة")}
          value={translations.currency}
          disabled
          description={translate(
            "Fixed asset payments are in the local currency, like the acquisition.",
            "مدفوعات الأصول الثابتة بالعملة المحلية مثل الاقتناء.",
          )}
        />
        <TextInput
          label={translate("Reference / Transaction No. (optional)", "المرجع / رقم العملية (اختياري)")}
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          maxLength={100}
        />
        <Textarea
          label={translate("Description (optional)", "البيان (اختياري)")}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          autosize
          minRows={2}
          maxLength={1000}
        />
        <Button
          type="submit"
          loading={loading}
          disabled={!(value > 0 && value <= outstanding) || !paymentAccount || !warehouseId || !date}
        >
          {translate("Record Payment", "تسجيل دفعة")}
        </Button>
      </form>
    </Modal>
  );
}
