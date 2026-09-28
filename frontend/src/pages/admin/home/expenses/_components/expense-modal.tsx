import { useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import { useWarehouses } from "@/context/WarehousesContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { PaymentMethod } from "@/types/payment";
import { Expense, ExpenseCategory } from "@/types/expense";
import { paymentMethodsArray } from "@/utils/constants/payment-methods";
import { expenseCategoriesArray } from "@/utils/constants/expense-categories";
import { Button, NumberInput, Select, Textarea } from "@mantine/core";
import ErrorAlert from "@/components/ui/error-alert";
import Modal from "@/components/ui/modal";
import useWarehouseHelpers from "@/hooks/useWarehouseHelpers";
import { notifySuccess } from "@/utils/helpers/notifiers";

export default function ExpenseModal({
  opened,
  close,
  callback,
}: {
  opened: boolean;
  close: () => void;
  callback: (expense: Expense) => void;
}) {
  const { language, translate, translations } = useLanguage();

  const { data: warehouses } = useWarehouses();
  const { updateWarehouseBalanceById } = useWarehouseHelpers();

  const [warehouseId, setWarehouseId] = useState("");
  const [expenseCategory, setExpenseCategory] = useState<ExpenseCategory | null>(null);
  const [description, setDescription] = useState<string>("");
  const [amountPaid, setAmountPaid] = useState<string | number>("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null);

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!warehouseId || !expenseCategory || !description || !amountPaid || !paymentMethod) {
      setError(translate("Please fill all required fields", "يرجى ملء جميع الحقول المطلوبة"));
      return;
    }

    handleRequest(language, setLoading, setError, async () => {
      const res = await privateRequest({
        method: "POST",
        url: "expenses",
        data: { warehouseId, expenseCategory, description, amountPaid, paymentMethod },
        language,
      });

      callback(res.data);

      updateWarehouseBalanceById(warehouseId, +amountPaid, "out");

      handleClose();

      notifySuccess({
        language,
        message: translate("Expense added successfully", "تمت إضافة النفقة بنجاح"),
        title: translate("Success", "نجاح"),
      });
    });
  }

  function handleClose() {
    close();
    setTimeout(() => {
      setWarehouseId("");
      setExpenseCategory(null);
      setDescription("");
      setPaymentMethod(null);
      setAmountPaid("");
      setError("");
    }, 250);
  }

  const title = translate("Add Expense", "إضافة نفقة");

  return (
    <Modal opened={opened} onClose={handleClose} title={title}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {/* Warehouse */}
        <Select
          clearable
          value={warehouseId}
          onChange={(value) => setWarehouseId(value as string)}
          data={warehouses.map((warehouse) => ({
            value: warehouse._id,
            label: warehouse.name,
          }))}
          label={translate("Warehouse", "الفرع")}
          placeholder={translate("Select warehouse", "اختر الفرع")}
          required
        />

        {/* Category Expense */}
        <Select
          clearable
          value={expenseCategory}
          onChange={(value) => setExpenseCategory(value as ExpenseCategory | null)}
          data={expenseCategoriesArray.map((cat) => ({
            value: cat.value,
            label: translate(cat.label.en, cat.label.ar),
          }))}
          label={translate("Expense Category", "نوع النفقة")}
          placeholder={translate("Select expense category", "اختر نوع النفقة")}
          required
        />

        {/* Description */}
        <Textarea
          label={translate("Description", "الوصف")}
          placeholder={translate("Enter description", "أدخل الوصف")}
          autosize
          minRows={3}
          value={description}
          onChange={(e) => setDescription(e.currentTarget.value)}
          required
        />

        {/* Amount */}
        <NumberInput
          value={amountPaid}
          onChange={(value) => setAmountPaid(value)}
          label={translate("Amount", "المبلغ")}
          placeholder={translate("Enter amount", "أدخل المبلغ")}
          min={0}
          decimalScale={2}
          hideControls
          required
        />

        {/* Payment Method */}
        <Select
          clearable
          value={paymentMethod}
          onChange={(value) => setPaymentMethod(value as PaymentMethod | null)}
          data={paymentMethodsArray.map((method) => ({
            value: method.value,
            label: translate(method.label.en, method.label.ar),
          }))}
          label={translate("Payment Method", "طريقة الدفع")}
          placeholder={translate("Select payment method", "اختر طريقة الدفع")}
          required
        />

        <div className="flex gap-2">
          <Button onClick={handleClose} variant="light" color="dark" fullWidth>
            {translations.cancel}
          </Button>
          <Button
            type="submit"
            loading={loading}
            disabled={!warehouseId || !expenseCategory || !description || !amountPaid || !paymentMethod}
            fullWidth
          >
            {title}
          </Button>
        </div>

        {error && <ErrorAlert error={error} />}
      </form>
    </Modal>
  );
}
