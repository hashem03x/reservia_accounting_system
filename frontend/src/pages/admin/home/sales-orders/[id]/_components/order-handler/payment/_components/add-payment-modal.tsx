import { useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import useWarehouseHelpers from "@/hooks/useWarehouseHelpers";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { paymentMethodsArray } from "@/utils/constants/payment-methods";
import { PaymentMethod } from "@/types/payment";
import { Button, NumberInput, Select, Textarea } from "@mantine/core";
import { solidIcons } from "@/components/icons";
import ErrorAlert from "@/components/ui/error-alert";
import Modal from "@/components/ui/modal";
import { useOrder } from "../../../../context";

export default function AddPaymentModal({ opened, close }: { opened: boolean; close: () => void }) {
  const { language, translate, translations } = useLanguage();

  const { order, setOrder, setPayments } = useOrder();

  const { updateWarehouseBalanceById } = useWarehouseHelpers();

  const [amountPaid, setAmountPaid] = useState<string | number>("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null);
  const [notes, setNotes] = useState<string>("");

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const remainingAmount = order.remainingAmount;

    if (+amountPaid <= 0) {
      setError(translate(`Please enter a valid amount.`, `الرجاء ادخال مبلغ صحيح.`));
      return;
    }

    if (+amountPaid > remainingAmount) {
      setError(
        translate(`Amount paid cannot exceed the remaining amount.`, `لا يمكن أن يتجاوز المبلغ المدفوع المبلغ المتبقي.`),
      );
      return;
    }

    handleRequest(language, setLoading, setError, async () => {
      const response = await privateRequest({
        language,
        method: "POST",
        url: "payment/sales",
        data: {
          warehouseId: order.warehouse,
          salesOrderId: order._id,
          amountPaid: amountPaid,
          paymentMethod,
          notes,
        },
      });
      updateWarehouseBalanceById(order.warehouse, +amountPaid, "in");
      setPayments((prev) => [response.data.payment, ...prev]);
      setOrder(response.data.salesOrder);
      handleClose();
    });
  }

  function handleClose() {
    close();
    setTimeout(() => {
      setError("");
      setAmountPaid("");
      setPaymentMethod(null);
      setNotes("");
    }, 250);
  }

  const title = translate(`Add Payment`, "اضافة دفعة");

  return (
    <Modal opened={opened} onClose={handleClose} title={title}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <NumberInput
            value={amountPaid}
            onChange={(value) => setAmountPaid(value)}
            label={`${translate("Amount Paid", "المبلغ المدفوع")} (${translations.currency})`}
            placeholder={`${translate("Enter amount paid", "ادخل المبلغ المدفوع")}`}
            min={0}
            max={order.remainingAmount}
            decimalScale={2}
            hideControls
            required
          />

          <Button
            variant="light"
            onClick={() => setAmountPaid(order.remainingAmount)}
            leftSection={<solidIcons.ArrowUp />}
            fullWidth
          >
            <span className="font-medium">{translate("Enter Full Amount", "ادخل المبلغ الكامل")}</span>
          </Button>

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

          <Textarea
            label={translate("Notes (Optional)", "ملاحظات (اختياري)")}
            placeholder={translate("Enter notes", "ادخل الملاحظات")}
            autosize
            minRows={3}
            value={notes}
            onChange={(e) => setNotes(e.currentTarget.value)}
          />
        </div>

        <div className="flex gap-2">
          <Button onClick={handleClose} variant="light" color="dark" fullWidth>
            {translations.cancel}
          </Button>
          <Button type="submit" loading={loading} disabled={!amountPaid || !paymentMethod} fullWidth>
            {title}
          </Button>
        </div>

        {error && <ErrorAlert error={error} />}
      </form>
    </Modal>
  );
}
