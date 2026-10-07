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
  // Equivalent Chart of Accounts account, or the vendor's existing Advanced Payment balance.
  const [paymentSource, setPaymentSource] = useState<"account" | "advanced_payment">("account");
  const [paymentAccount, setPaymentAccount] = useState("");
  const [notes, setNotes] = useState<string>("");

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  const vendorId = order.vendor?._id;
  const {
    privateRequest: fetchAdvanceRequest,
    data: availableAdvance,
    setData: setAvailableAdvance,
    loading: advanceLoading,
  } = useDataHandler<AdvancedPayment | null>({ initialData: null });
  useEffect(() => {
    if (paymentSource !== "advanced_payment" || !vendorId) {
      setAvailableAdvance(null);
      return;
    }
    fetchAdvanceRequest({ url: "advanced-payments/available", params: { vendor: vendorId }, language })
      .then((res) => setAvailableAdvance(res.data))
      .catch(() => setAvailableAdvance(null));
  }, [paymentSource, vendorId]);

  const isAdvancedPayment = paymentSource === "advanced_payment";

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const remainingAmount = order.remainingAmount;

    // const invalidPositive = balanceDue > 0 && (+amountToPay > balanceDue || +amountToPay <= 0); // You pay vendor
    // const invalidNegative = balanceDue < 0 && (+amountToPay < balanceDue || +amountToPay >= 0); // Vendor pays you

    // if (invalidPositive) {
    //   setError(
    //     translate(
    //       `Amount paid should be between 0 and ${balanceDue} ${translations.currency}`,
    //       `يجب أن يكون المبلغ المدفوع بين 0 و ${balanceDue} ${translations.currency}`,
    //     ),
    //   );
    //   return;
    // } else if (invalidNegative) {
    //   setError(
    //     translate(
    //       `Amount paid should be between ${balanceDue} and 0 ${translations.currency}`,
    //       `يجب أن يكون المبلغ المدفوع بين ${balanceDue} و 0 ${translations.currency}`,
    //     ),
    //   );
    //   return;
    // }

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
      setError(
        translate(
          `Amount paid cannot exceed the available advanced payment.`,
          `لا يمكن أن يتجاوز المبلغ المدفوع الدفعة المقدمة المتاحة.`,
        ),
      );
      return;
    }

    handleRequest(language, setLoading, setError, async () => {
      const response = await privateRequest({
        language,
        method: "POST",
        url: "payment/purchase",
        data: {
          warehouseId: order.warehouseId,
          purchaseOrderId: order._id,
          amountPaid: amountPaid,
          paymentAccount: isAdvancedPayment ? undefined : paymentAccount,
          useAdvancedPayment: isAdvancedPayment || undefined,
          notes,
        },
      });
      updateWarehouseBalanceById(order.warehouseId, +amountPaid, "out");
      setPayments((prev) => [response.data.payment, ...prev]);
      setOrder(response.data.purchaseOrder);
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
            description={translate("Enter the amount to be paid to the vendor.", "ادخل المبلغ الذي سيتم دفعه للبائع")}
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
              { value: "advanced_payment", label: translate("Advanced Payment", "دفعة مقدمة") },
            ]}
            allowDeselect={false}
          />

          {isAdvancedPayment ? (
            advanceLoading ? (
              <p className="text-sm text-gray-400">
                {translate("Loading available advance...", "جاري تحميل الدفعة المتاحة...")}
              </p>
            ) : availableAdvance && availableAdvance.remainingAmount > 0 ? (
              <Alert color="green" variant="light">
                {translate("Available Advanced Payment", "الدفعة المقدمة المتاحة")}:{" "}
                <b>
                  {availableAdvance.remainingAmount.toLocaleString()} {availableAdvance.currency || translations.currency}
                </b>
              </Alert>
            ) : (
              <Alert color="red" variant="light">
                {translate("No available advanced payment exists for this vendor.", "لا توجد دفعة مقدمة متاحة لهذا البائع.")}
              </Alert>
            )
          ) : (
            <PaymentAccountSelect value={paymentAccount} onChange={setPaymentAccount} required />
          )}

          <Textarea
            label={translate("Notes (Optional)", "ملاحظات (اختياري)")}
<<<<<<< HEAD
            description={translate("Used as the description of the journal entry created for this payment.", "تُستخدم كوصف لقيد اليومية الذي يتم إنشاؤه لهذه الدفعة.")}
=======
>>>>>>> 368811657e0eba1f2e8b46ee732d01745194d628
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
            disabled={
              !amountPaid ||
              (isAdvancedPayment ? !availableAdvance || availableAdvance.remainingAmount <= 0 : !paymentAccount)
            }
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
