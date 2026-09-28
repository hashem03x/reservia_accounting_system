import { useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import useWarehouseHelpers from "@/hooks/useWarehouseHelpers";
import useDataHandler from "@/hooks/useDataHandler";
import { PaymentMethod } from "@/types/payment";
import handleRequest from "@/utils/helpers/handle-request";
import { Alert, Button, Select } from "@mantine/core";
import ErrorAlert from "@/components/ui/error-alert";
import Modal from "@/components/ui/modal";
import { useOrder } from "../../../../context";
import { paymentMethodsArray } from "@/utils/constants/payment-methods";
import { solidIcons } from "@/components/icons";

export default function ReturnAllItemsModal({ opened, close }: { opened: boolean; close: () => void }) {
  const { language, translate, translations } = useLanguage();

  const { order, setOrder, setPayments, setReturnRecords } = useOrder();

  const { updateWarehouseBalanceById } = useWarehouseHelpers();

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null);

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    handleRequest(language, setLoading, setError, async () => {
      const response = await privateRequest({
        language,
        method: "POST",
        url: `sale-orders/returns/return-all`,
        data: {
          salesOrderId: order._id,
          warehouseId: order.warehouse || "67933fd03bf29b9f172eeab6", // Fallback to main warehouse if not set (in case of website orders)
          paymentMethod,
        },
      });

      setOrder(response.data.salesOrder);
      setReturnRecords((prev) => [...response.data.returns, ...prev]);
      if (response.data.payment) {
        setPayments((prev) => [response.data.payment, ...prev]);
        updateWarehouseBalanceById(order.warehouse, response.data.payment.amountPaid, "out");
      }

      handleClose();
    });
  }

  function handleClose() {
    close();
    setTimeout(() => {
      setError("");
      setPaymentMethod(null);
    }, 250);
  }

  const title = translate(`Return All Items`, `ارجاع الكل`);

  return (
    <Modal opened={opened} onClose={handleClose} title={title}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
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
            description={translate("Payment method used in case of refund", "طريقة الدفع المستخدمة في حالة الاسترجاع")}
            required
          />
        </div>

        {loading && (
          <Alert radius="md" icon={<solidIcons.Spinner className="animate-spin" />} color="blue">
            {translate(
              "Processing return request... Updating inventory, adjusting accounts, and issuing refund. Please wait.",
              "جاري معالجة طلب الإرجاع... تحديث المخزون وتعديل الحسابات وإصدار المبلغ المسترد. يرجى الانتظار.",
            )}
          </Alert>
        )}

        <div className="flex gap-2">
          <Button onClick={handleClose} variant="light" color="dark" fullWidth>
            {translations.cancel}
          </Button>
          <Button type="submit" disabled={!paymentMethod || loading} fullWidth>
            {title}
          </Button>
        </div>

        {error && <ErrorAlert error={error} />}
      </form>
    </Modal>
  );
}
