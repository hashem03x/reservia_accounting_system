import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useDisclosure } from "@mantine/hooks";
import { useLanguage } from "@/context/LanguageContext";
import { useWarehouses } from "@/context/WarehousesContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import useHasPermission from "@/hooks/useHasPermission";
import useWarehouseHelpers from "@/hooks/useWarehouseHelpers";
import handleRequest from "@/utils/helpers/handle-request";
import { formatDate } from "@/utils/helpers/date-formaters";
import { formatAmount } from "@/utils/helpers/format-amount";
import { toDateOnly } from "@/utils/helpers/format-date";
import paths from "@/utils/constants/paths";
import resources from "@/utils/constants/resources";
import actions from "@/utils/constants/actions";
import { Badge, Button, NumberInput, Select, Table, Textarea, TextInput } from "@mantine/core";
import { DateInput } from "@mantine/dates";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import ErrorAlert from "@/components/ui/error-alert";
import InfoItem from "@/components/ui/info-item";
import Modal from "@/components/ui/modal";
import JournalEntryLink from "@/components/global/journal-entry-link";
import PaymentAccountSelect from "@/components/global/payment-account-select";
import { Expense } from "@/types/expense";
import { ChartOfAccountRef } from "@/types/orders";
import { expenseStatusColors, useExpenseStatusLabel } from "../_components/status";

const accountText = (account?: ChartOfAccountRef | string | null) => (account && typeof account !== "string" ? `${account.code} - ${account.name}` : "-");

export default function ExpenseDetail() {
  const { id } = useParams();
  const { language, translate, translations } = useLanguage();
  const statusLabel = useExpenseStatusLabel();
  const canCreate = useHasPermission(resources.expenses, actions.create);
  const canUpdate = useHasPermission(resources.expenses, actions.update);

  const { privateRequest, loading, setLoading, error, setError, data: expense, setData: setExpense } = useDataHandler<Expense | null>({
    initialData: null,
    initialLoading: true,
  });

  useDocumentTitle(`${translations.pages.expenses} | ${translations.adminPanel}`);

  function load() {
    handleRequest(language, setLoading, setError, async () => {
      const res = await privateRequest({ url: `expenses/${id}`, language });
      setExpense(res.data);
    });
  }

  useEffect(() => {
    load();
  }, [id]);

  const [paymentOpened, { open: openPayment, close: closePayment }] = useDisclosure();
  const [editOpened, { open: openEdit, close: closeEdit }] = useDisclosure();

  if (loading) return <LoadingSection message={translate("Loading expense...", "جاري تحميل النفقة...")} />;
  if (error) return <ErrorSection errorTitle={translate("Error loading expense", "خطأ في تحميل النفقة")} errorMessage={error} button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: load }} />;
  if (!expense) return null;

  const money = (value: unknown) => formatAmount(value, translations.currency);
  const remaining = expense.remainingAmount ?? 0;
  const status = expense.paymentStatus || "unpaid";

  return (
    <AdminLayoutBox
      header={{
        title: translate("Expense", "نفقة"),
        subTitle: expense.vendor?.name,
        backLink: `/${paths.admin}/${paths.home}/${paths.expenses}`,
        sideElements: expense.vendor && (
          <div className="flex flex-wrap gap-2">
            {canUpdate && (
              <Button variant="light" onClick={openEdit}>
                {translate("Edit", "تعديل")}
              </Button>
            )}
            {canCreate && remaining > 0 && (
              <Button variant="light" color="teal" onClick={openPayment}>
                {translate("Add Payment", "إضافة دفعة")}
              </Button>
            )}
          </div>
        ),
      }}
    >
      <div className="grid grid-cols-1 gap-x-8 gap-y-2 md:grid-cols-2">
        <InfoItem label={translate("Status", "الحالة")} value={<Badge color={expenseStatusColors[status]} variant="light">{statusLabel(status)}</Badge>} />
        <InfoItem label={translate("Date", "التاريخ")} value={formatDate(expense.date || expense.createdAt, language)} />
        <InfoItem label={translate("Vendor", "البائع")} value={expense.vendor ? `${expense.vendor.name}${expense.vendor.vendorNumber != null ? ` (${expense.vendor.vendorNumber})` : ""}` : "-"} />
        <InfoItem label={translate("Expense Account", "حساب المصروف")} value={accountText(expense.expenseAccount)} />
        <InfoItem label={translate("Amount", "المبلغ")} value={money(expense.amount)} />
        <InfoItem label={translate("VAT", "ضريبة القيمة المضافة")} value={`${money(expense.vatAmount ?? 0)} (${expense.vatPercentage ?? 0}%)`} />
        <InfoItem label={translate("Total", "الإجمالي")} value={money(expense.totalAmount)} />
        <InfoItem label={translate("Paid", "المدفوع")} value={money(expense.paidAmount ?? 0)} />
        <InfoItem label={translate("Remaining", "المتبقي")} value={money(remaining)} />
        <InfoItem label={translate("Reference", "المرجع")} value={expense.reference || "-"} />
        <InfoItem label={translate("Journal Entry", "القيد")} value={<JournalEntryLink entry={expense.journalEntry} />} />
        <InfoItem label={translate("By", "بواسطة")} value={expense.createdBy?.name || "-"} />
      </div>

      {expense.notes && <p className="mt-4 text-gray-600">{expense.notes}</p>}

      <div className="mt-6 flex flex-col gap-3">
        <h4>{translate("Payments", "المدفوعات")}</h4>
        {!expense.payments?.length ? (
          <p className="text-sm text-gray-400">{translate("No payments yet.", "لا توجد مدفوعات بعد.")}</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <Table striped withColumnBorders>
              <Table.Thead className="bg-gray-100">
                <Table.Tr>
                  <Table.Th>{translate("Date", "التاريخ")}</Table.Th>
                  <Table.Th>{translate("Payment Method", "طريقة الدفع")}</Table.Th>
                  <Table.Th className="text-right">{translate("Amount", "المبلغ")}</Table.Th>
                  <Table.Th>{translate("Journal Entry", "القيد")}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {expense.payments.map((p) => (
                  <Table.Tr key={p.payment}>
                    <Table.Td>{formatDate(p.date, language)}</Table.Td>
                    <Table.Td>{accountText(p.paymentAccount)}</Table.Td>
                    <Table.Td className="text-right tabular-nums">{money(p.amount)}</Table.Td>
                    <Table.Td>
                      <JournalEntryLink entry={p.journalEntry} />
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </div>
        )}
      </div>

      <AddExpensePaymentModal opened={paymentOpened} close={closePayment} expense={expense} onPaid={load} />
      <EditExpenseModal opened={editOpened} close={closeEdit} expense={expense} onSaved={load} />
    </AdminLayoutBox>
  );
}

// Dr Vendor / Cr the selected Cash or Cash Equivalent account - never more than what is still owed.
function AddExpensePaymentModal({ opened, close, expense, onPaid }: { opened: boolean; close: () => void; expense: Expense; onPaid: () => void }) {
  const { language, translate, translations } = useLanguage();
  const { data: warehouses } = useWarehouses();
  const { updateWarehouseBalanceById } = useWarehouseHelpers();
  const remaining = expense.remainingAmount ?? 0;

  const [amount, setAmount] = useState<string | number>(remaining);
  const [paymentAccount, setPaymentAccount] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [date, setDate] = useState<Date | null>(new Date());
  const [notes, setNotes] = useState("");
  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  useEffect(() => {
    if (opened) {
      setAmount(remaining);
      setError("");
    }
  }, [opened]);

  const value = typeof amount === "number" ? amount : 0;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    handleRequest(language, setLoading, setError, async () => {
      await privateRequest({
        language,
        method: "POST",
        url: `expenses/${expense._id}/payments`,
        data: { amount, paymentAccount, warehouseId, date: date ? toDateOnly(date) : undefined, notes: notes || undefined },
      });
      updateWarehouseBalanceById(warehouseId, value, "out");
      onPaid();
      close();
      setPaymentAccount("");
      setWarehouseId("");
      setNotes("");
    });
  }

  return (
    <Modal opened={opened} onClose={close} title={translate("Add Payment", "إضافة دفعة")}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error && <ErrorAlert error={error} />}
        <NumberInput
          label={translate("Amount", "المبلغ")}
          description={`${translate("Remaining", "المتبقي")}: ${remaining.toLocaleString()} ${translations.currency}`}
          value={amount}
          onChange={setAmount}
          min={0.01}
          max={remaining}
          decimalScale={2}
          thousandSeparator
          required
        />
        <PaymentAccountSelect value={paymentAccount} onChange={setPaymentAccount} label={translate("Payment Method", "طريقة الدفع")} required />
        <Select
          label={translate("Warehouse", "الفرع")}
          placeholder={translate("Select warehouse", "اختر الفرع")}
          value={warehouseId || null}
          onChange={(v) => setWarehouseId(v || "")}
          data={warehouses.map((w) => ({ value: w._id, label: w.name }))}
          required
        />
        <DateInput label={translate("Date", "التاريخ")} value={date} onChange={setDate} />
        <Textarea label={translate("Notes (optional)", "ملاحظات (اختياري)")} value={notes} onChange={(e) => setNotes(e.target.value)} autosize minRows={2} />
        <Button type="submit" loading={loading} disabled={!(value > 0 && value <= remaining) || !paymentAccount || !warehouseId}>
          {translate("Pay", "دفع")}
        </Button>
      </form>
    </Modal>
  );
}

function EditExpenseModal({ opened, close, expense, onSaved }: { opened: boolean; close: () => void; expense: Expense; onSaved: () => void }) {
  const { language, translate } = useLanguage();
  const [reference, setReference] = useState(expense.reference || "");
  const [notes, setNotes] = useState(expense.notes || "");
  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  useEffect(() => {
    if (!opened) return;
    setReference(expense.reference || "");
    setNotes(expense.notes || "");
    setError("");
  }, [opened]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    handleRequest(language, setLoading, setError, async () => {
      await privateRequest({ language, method: "PATCH", url: `expenses/${expense._id}`, data: { reference, notes } });
      onSaved();
      close();
    });
  }

  return (
    <Modal opened={opened} onClose={close} title={translate("Edit Expense", "تعديل النفقة")}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error && <ErrorAlert error={error} />}
        <p className="text-xs text-gray-500">{translate("Amounts, accounts and vendor cannot change once posted.", "لا يمكن تغيير المبالغ والحسابات والبائع بعد الترحيل.")}</p>
        <TextInput label={translate("Reference", "المرجع")} value={reference} onChange={(e) => setReference(e.target.value)} />
        <Textarea label={translate("Notes", "ملاحظات")} value={notes} onChange={(e) => setNotes(e.target.value)} autosize minRows={2} />
        <Button type="submit" loading={loading}>
          {translate("Save", "حفظ")}
        </Button>
      </form>
    </Modal>
  );
}
