import { useEffect, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import useWarehouseHelpers from "@/hooks/useWarehouseHelpers";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { Alert, Button, NumberInput, Select, Textarea } from "@mantine/core";
import { solidIcons } from "@/components/icons";
import ErrorAlert from "@/components/ui/error-alert";
import Modal from "@/components/ui/modal";
import PaymentAccountSelect from "@/components/global/payment-account-select";
import { AdvancedPayment } from "@/types/advanced-payment";
import { useOrder } from "../../../../context";

export default function AddPaymentModal({ opened, close }: { opened: boolean; close: () => void }) {
  const { language, translate, translations } = useLanguage();

  const { order, setOrder, setPayments } = useOrder();

  const { updateWarehouseBalanceById } = useWarehouseHelpers();

  const [amountPaid, setAmountPaid] = useState<string | number>("");
  // Payment Method Options (docs section "Add Payment - Payment Method Options") - a Cash/Cash-
  // Equivalent Chart of Accounts account, or the customer's existing Advanced Payment balance.
  // Never a hardcoded list - the account choices come from PaymentAccountSelect's own eligible-
  // accounts API call, and the advance comes from the live AdvancedPayment balance below.
  const [paymentSource, setPaymentSource] = useState<"account" | "advanced_payment">("account");
  const [paymentAccount, setPaymentAccount] = useState("");
  const [notes, setNotes] = useState<string>("");

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  // Customer Advanced Payments are always tied to a project (see advancedPaymentModel.js) - only
  // offered here when this order actually has one.
  const projectId = order.project?._id;
  const {
    privateRequest: fetchAdvanceRequest,
    data: availableAdvance,
    setData: setAvailableAdvance,
    loading: advanceLoading,
  } = useDataHandler<AdvancedPayment | null>({ initialData: null });
  useEffect(() => {
    if (paymentSource !== "advanced_payment" || !projectId) {
      setAvailableAdvance(null);
      return;
    }
    fetchAdvanceRequest({ url: "advanced-payments/available", params: { customer: order.customer?._id || "", project: projectId }, language })
      .then((res) => setAvailableAdvance(res.data))
      .catch(() => setAvailableAdvance(null));
  }, [paymentSource, projectId]);

  const isAdvancedPayment = paymentSource === "advanced_payment";

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

    if (isAdvancedPayment && (!availableAdvance || +amountPaid > availableAdvance.remainingAmount)) {
      setError(translate(`Amount paid cannot exceed the available advanced payment.`, `لا يمكن أن يتجاوز المبلغ المدفوع الدفعة المقدمة المتاحة.`));
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
          paymentAccount: isAdvancedPayment ? undefined : paymentAccount,
          useAdvancedPayment: isAdvancedPayment || undefined,
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
      setPaymentSource("account");
      setPaymentAccount("");
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
            label={translate("Payment Source", "مصدر الدفع")}
            value={paymentSource}
            onChange={(v) => setPaymentSource((v as "account" | "advanced_payment") || "account")}
            data={[
              { value: "account", label: translate("Cash & Cash Equivalents", "نقدية وما يعادلها") },
              { value: "advanced_payment", label: translate("Advanced Payment", "دفعة مقدمة"), disabled: !projectId },
            ]}
            allowDeselect={false}
          />

          {isAdvancedPayment ? (
            !projectId ? (
              <Alert color="yellow" variant="light">
                {translate("This order has no project - an advanced payment is not available.", "لا يوجد مشروع لهذا الطلب - الدفعة المقدمة غير متاحة.")}
              </Alert>
            ) : advanceLoading ? (
              <p className="text-sm text-gray-400">{translate("Loading available advance...", "جاري تحميل الدفعة المتاحة...")}</p>
            ) : availableAdvance && availableAdvance.remainingAmount > 0 ? (
              <Alert color="green" variant="light">
                {translate("Available Advanced Payment", "الدفعة المقدمة المتاحة")}: <b>{availableAdvance.remainingAmount.toLocaleString()} {availableAdvance.currency || translations.currency}</b>
              </Alert>
            ) : (
              <Alert color="red" variant="light">
                {translate("No available advanced payment exists for this project.", "لا توجد دفعة مقدمة متاحة لهذا المشروع.")}
              </Alert>
            )
          ) : (
            <PaymentAccountSelect value={paymentAccount} onChange={setPaymentAccount} required />
          )}

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
          <Button
            type="submit"
            loading={loading}
            disabled={!amountPaid || (isAdvancedPayment ? !availableAdvance || availableAdvance.remainingAmount <= 0 : !paymentAccount)}
            fullWidth
          >
            {title}
          </Button>
        </div>

        {error && <ErrorAlert error={error} />}
      </form>
    </Modal>
  )