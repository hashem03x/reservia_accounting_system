import { useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import useWarehouseHelpers from "@/hooks/useWarehouseHelpers";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { Alert, Button } from "@mantine/core";
import { solidIcons } from "@/components/icons";
import ErrorAlert from "@/components/ui/error-alert";
import Modal from "@/components/ui/modal";
import PaymentAccountSelect from "@/components/global/payment-account-select";
import { useOrder } from "../../../../context";
import InfoItem from "@/components/ui/info-item";

// A component to pay all the remaining amount of an order

export default function PayAllModal({ opened, close }: { opened: boolean; close: () => void }) {
  const { language, translate, translations } = useLanguage();

  const { order, setOrder, setPayments } = useOrder();

  const { updateWarehouseBalanceById } = useWarehouseHelpers();

  const amountToPay = order.remainingAmount;

  const [paymentAccount, setPaymentAccount] = useState("");

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    handleRequest(language, setLoading, setError, async () => {
      const paymentResponse = await privateRequest({
        language,
        method: "POST",
        url: "payment/sales",
        data: {
          warehouseId: order.warehouse,
          salesOrderId: order._id,
          amountPaid: amountToPay,
          paymentAccount,
        },
      });
      updateWarehouseBalanceById(order.warehouse, amountToPay, "in");
      setPayments((prev) => [paymentResponse.data.payment, ...prev]);
      setOrder(paymentResponse.data.salesOrder);
      handleClose();
    });
  }

  function handleClose() {
    close();
    setTimeout(() => {
      setError("");
      setPaymentAccount("");
    }, 250);
  }

  const title = translate(`Pay All`, `دفع الكل`);

  return (
    <Modal opened={opened} onClose={handleClose} title={title}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-2.5">
        <div className="flex flex-col gap-1.5">
          <InfoItem
            label={translate("Amount to pay", "المبلغ المطلوب دفعه")}
            value={`${amountToPay.toFixed(2)} ${translations.currency}`}
          />
        </div>
        <Alert radius="md" icon={<solidIcons.ExclamationCircle />} color="blue">
          {translate(
            "You are about to pay all the remaining amount of this order.",
            "انت على وشك دفع المبلغ المتبقي من هذا الطلب كاملا.",
          )}
        </Alert>

        <div className="flex flex-col gap-2">
          <PaymentAccountSelect value={paymentAccount} onChange={setPaymentAccount} required />
        </div>

        <div className="flex gap-2">
          <Button onClick={handleClose} variant="light" color="dark" fullWidth>
            {translations.cancel}
          </Button>
          <Button type="submit" loading={loading} disabled={!paymentAccount} fullWidth>
            {title}
          </Button>
        </div>

        {error && <ErrorAlert error={error} />}
      </form>
    </Modal>
  );
}
