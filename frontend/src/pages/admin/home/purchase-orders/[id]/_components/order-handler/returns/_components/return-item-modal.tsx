import { useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import useWarehouseHelpers from "@/hooks/useWarehouseHelpers";
import useDataHandler from "@/hooks/useDataHandler";
import { PurchaseOrderItem } from "@/types/orders";
import { PaymentMethod } from "@/types/payment";
import handleRequest from "@/utils/helpers/handle-request";
import { getColorLabel } from "@/utils/constants/colors";
import { Button, NumberInput, Select } from "@mantine/core";
import ErrorAlert from "@/components/ui/error-alert";
import Modal from "@/components/ui/modal";
import { useOrder } from "../../../../context";
import { paymentMethodsArray } from "@/utils/constants/payment-methods";

export default function ReturnItemModal({ opened, close }: { opened: boolean; close: () => void }) {
  const { language, translate, translations } = useLanguage();

  const { order, setOrder, setPayments, setReturnRecords } = useOrder();

  const { updateWarehouseBalanceById } = useWarehouseHelpers();

  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState<string | number>("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null);

  const selectedItem: PurchaseOrderItem | null = order?.items.find((item) => item._id === selectedItemId) || null;

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!selectedItem) return;

    if (+quantity > selectedItem.starterQuantity) {
      setError(translate("Quantity exceeds the available quantity", "الكمية تتجاوز الكمية المتاحة"));
      return;
    }

    handleRequest(language, setLoading, setError, async () => {
      const response = await privateRequest({
        language,
        method: "POST",
        url: `purchaseorder/returns`,
        data: {
          purchaseOrderId: order._id,
          warehouseId: order.warehouseId,
          variantId: selectedItem.variant._id,
          returnedQuantity: quantity,
          paymentMethod,
        },
      });

      setOrder(response.data.purchaseOrder);
      setReturnRecords((prev) => [response.data.return, ...prev]);
      if (response.data.payment) {
        setPayments((prev) => [response.data.payment, ...prev]);
        updateWarehouseBalanceById(order.warehouseId, response.data.payment.amountPaid, "in");
      }

      handleClose();
    });
  }

  function handleClose() {
    close();
    setTimeout(() => {
      setError("");
      setSelectedItemId(null);
      setQuantity("");
      setPaymentMethod(null);
    }, 250);
  }

  const title = translate(`Return Item`, `ارجاع عنصر`);

  return (
    <Modal opened={opened} onClose={handleClose} title={title}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Select
            clearable
            searchable
            value={selectedItemId}
            onChange={(value) => setSelectedItemId(value)}
            data={order.items.map((item) => ({
              value: item._id,
              label: `${item.variant.variantCode} - ${translate(item.variant.product.title.en, item.variant.product.title.ar)} - ${getColorLabel(item.variant.color, language)} - ${item.variant.size}`,
            }))}
            label={translate("Select Item", "اختر العنصر")}
            placeholder={translate("Select item to return", "اختر العنصر المرتجع")}
            required
          />

          <NumberInput
            value={quantity}
            onChange={(value) => setQuantity(value)}
            label={`${translate("Quantity", "الكمية")}`}
            placeholder={`${translate("Enter quantity to return", "ادخل الكمية المرتجعة")}`}
            min={0}
            max={(selectedItem?.starterQuantity || 0) - (selectedItem?.returnedQuantity || 0)}
            decimalScale={0}
            required
          />

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

        <div className="flex gap-2">
          <Button onClick={handleClose} variant="light" color="dark" fullWidth>
            {translations.cancel}
          </Button>
          <Button type="submit" loading={loading} disabled={!selectedItem || !quantity || !paymentMethod} fullWidth>
            {title}
          </Button>
        </div>

        {error && <ErrorAlert error={error} />}
      </form>
    </Modal>
  );
}
