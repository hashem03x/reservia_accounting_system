import { useEffect, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import { useWarehouses } from "@/context/WarehousesContext";
import useDataHandler from "@/hooks/useDataHandler";
import useWarehouseHelpers from "@/hooks/useWarehouseHelpers";
import handleRequest from "@/utils/helpers/handle-request";
import { toDateOnly } from "@/utils/helpers/format-date";
import { notifySuccess } from "@/utils/helpers/notifiers";
import { Button, NumberInput, Select, Switch, Textarea, TextInput } from "@mantine/core";
import { DateInput } from "@mantine/dates";
import ErrorAlert from "@/components/ui/error-alert";
import Modal from "@/components/ui/modal";
import VendorSearch from "@/components/global/vendor-search";
import PaymentAccountSelect from "@/components/global/payment-account-select";
import { Vendor } from "@/types/vendor";
import { Expense } from "@/types/expense";
import { ChartOfAccountRef } from "@/types/orders";

// A vendor expense: Dr the chosen expense account (+ VAT) / Cr the vendor. It can be paid at once
// (Pay now) or later from the expense's page.
export default function ExpenseModal({ opened, close, callback }: { opened: boolean; close: () => void; callback: (expense: Expense) => void }) {
  const { language, translate, translations } = useLanguage();
  const { data: warehouses } = useWarehouses();
  const { updateWarehouseBalanceById } = useWarehouseHelpers();

  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [expenseAccount, setExpenseAccount] = useState("");
  const [amount, setAmount] = useState<string | number>("");
  const [vatPercentage, setVatPercentage] = useState<string | number>(0);
  const [date, setDate] = useState<Date | null>(new Date());
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [payNow, setPayNow] = useState(false);
  const [paymentAccount, setPaymentAccount] = useState("");
  const [warehouseId, setWarehouseId] = useState("");

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });
  const { privateRequest: loadAccounts, data: expenseAccounts, setData: setExpenseAccounts } = useDataHandler<ChartOfAccountRef[]>({ initialData: [] });

  useEffect(() => {
    if (!opened || expenseAccounts.length) return;
    loadAccounts({ url: "expenses/account-options", language })
      .then((res) => setExpenseAccounts(res.data))
      .catch(() => setExpenseAccounts([]));
  }, [opened]);

  const base = typeof amount === "number" ? amount : 0;
  const vat = typeof vatPercentage === "number" ? vatPercentage : 0;
  const vatAmount = Math.round(base * vat) / 100;
  const total = Math.round((base + vatAmount) * 100) / 100;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    handleRequest(language, setLoading, setError, async () => {
      const res = await privateRequest({
        language,
        method: "POST",
        url: "expenses",
        data: {
          vendor: vendor?._id,
          expenseAccount,
          amount,
          vatPercentage: vat,
          date: date ? toDateOnly(date) : undefined,
          reference: reference || undefined,
          notes: notes || undefined,
          payment: payNow ? { paymentAccount, warehouseId } : undefined,
        },
      });
      if (payNow) updateWarehouseBalanceById(warehouseId, total, "out");
      notifySuccess({ message: translate("Expense created", "تم إنشاء النفقة"), language });
      callback(res.data);
      handleClose();
    });
  }

  function handleClose() {
    close();
    setTimeout(() => {
      setVendor(null);
      setExpenseAccount("");
      setAmount("");
      setVatPercentage(0);
      setDate(new Date());
      setReference("");
      setNotes("");
      setPayNow(false);
      setPaymentAccount("");
      setWarehouseId("");
      setError("");
    }, 250);
  }

  const canSubmit = !!vendor && !!expenseAccount && base > 0 && !!date && (!payNow || (!!paymentAccount && !!warehouseId));

  return (
    <Modal opened={opened} onClose={handleClose} title={translate("Add Expense", "إضافة نفقة")} size="lg">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error && <ErrorAlert error={error} />}

        <VendorSearch vendor={vendor} setVendor={setVendor} label={translate("Vendor", "البائع")} placeholder={translate("Search for a vendor", "ابحث عن بائع")} required />

        <Select
          label={translate("Expense Account", "حساب المصروف")}
          placeholder={translate("Select account", "اختر الحساب")}
          value={expenseAccount || null}
          onChange={(v) => setExpenseAccount(v || "")}
          data={expenseAccounts.map((a) => ({ value: a._id, label: `${a.code} - ${a.name}` }))}
          nothingFoundMessage={translate("No expense accounts in the Chart of Accounts", "لا توجد حسابات مصروفات في دليل الحسابات")}
          searchable
          required
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <NumberInput label={translate("Amount", "المبلغ")} value={amount} onChange={setAmount} min={0.01} decimalScale={2} thousandSeparator required />
          <NumberInput label={translate("VAT %", "ضريبة القيمة المضافة %")} value={vatPercentage} onChange={setVatPercentage} min={0} max={100} decimalScale={2} />
        </div>

        <p className="-mt-2 text-sm text-gray-600">
          {translate("Total", "الإجمالي")}: <b>{total.toLocaleString()} {translations.currency}</b>
          {vatAmount > 0 && ` (${translate("VAT", "الضريبة")} ${vatAmount.toLocaleString()})`}
        </p>

        <DateInput label={translate("Date", "التاريخ")} value={date} onChange={setDate} required />
        <TextInput label={translate("Reference (optional)", "المرجع (اختياري)")} value={reference} onChange={(e) => setReference(e.target.value)} />
        <Textarea label={translate("Notes (optional)", "ملاحظات (اختياري)")} value={notes} onChange={(e) => setNotes(e.target.value)} autosize minRows={2} />

        <Switch label={translate("Pay now", "الدفع الآن")} checked={payNow} onChange={(e) => setPayNow(e.currentTarget.checked)} />
        {payNow && (
          <>
            <PaymentAccountSelect value={paymentAccount} onChange={setPaymentAccount} label={translate("Payment Method", "طريقة الدفع")} required />
            <Select
              label={translate("Warehouse", "الفرع")}
              placeholder={translate("Select warehouse", "اختر الفرع")}
              value={warehouseId || null}
              onChange={(v) => setWarehouseId(v || "")}
              data={warehouses.map((w) => ({ value: w._id, label: w.name }))}
              required
            />
          </>
        )}

        <Button type="submit" loading={loading} disabled={!canSubmit} mt="md">
          {translate("Create", "إنشاء")}
        </Button>
      </form>
    </Modal>
  );
}
