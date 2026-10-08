import { useLanguage } from "@/context/LanguageContext";
import useStringifyOnlineAddress from "@/hooks/useStringifyOnlineAddress";
import InfoItem from "@/components/ui/info-item";
import { solidIcons } from "@/components/icons";
import { useOrder } from "../../../../../context";
import { Alert, Button } from "@mantine/core";
import { isCanceledOrder } from "@/utils/constants/order-statuses";
import { useDisclosure } from "@mantine/hooks";
import ConfirmCodModal from "./_components/confirm-cod-modal";
import CancelOrderModal from "./_components/cancel-order-modal";

export default function WebsiteDetailsSection() {
  const { translate } = useLanguage();
  const { order } = useOrder();

  const [confirmCodModalOpened, { open: openConfirmCodModal, close: closeConfirmCodModal }] = useDisclosure();
  const [cancelOrderModalOpened, { open: openCancelOrderModal, close: closeCancelOrderModal }] = useDisclosure();

  return (
    <div className="rounded-lg border">
      <span className="flex items-center gap-2.5 border-b bg-gray-100 px-4 py-3 font-semibold text-gray-800">
        <solidIcons.Circle className="text-blue-500" size={15} />
        {translate("This order was placed through the website", "تم تقديم هذا الطلب من خلال الموقع الإلكتروني")}
      </span>

      <div className="flex flex-col gap-2 p-4">
        {order.shippingAddress && (
          <>
            <InfoItem label={translate("Address", "العنوان")} value={useStringifyOnlineAddress(order.shippingAddress)} />
            <InfoItem label={translate("Delivery Number", "رقم التوصيل")} value={order.shippingAddress?.phone} />
            {order.isCodOrder && (
              <div className="flex flex-wrap items-center gap-2">
                <InfoItem
                  label={translate("Payment Method", "طريقة الدفع")}
                  value={translate("Cash on Delivery (COD)", "الدفع عند الاستلام")}
                />

                {order.needCardReader && (
                  <div className="text-sm font-medium text-orange-500">
                    -{" "}
                    {translate(
                      "The customer requested to use a card reader for payment.",
                      "طلب العميل استخدام جهاز قراءة البطاقات للدفع.",
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {!isCanceledOrder(order.orderStatus) && order.isCodOrder && (
          <>
            <Alert
              radius="md"
              color={order.isCodOrderConfirmed ? "green" : "orange"}
              icon={<solidIcons.ExclamationCircle size={16} />}
            >
              {order.isCodOrderConfirmed ? (
                <span>{translate("Order confirmed with a deposit.", "تم تأكيد الطلب بدفع عربون.")}</span>
              ) : (
                <span>
                  {translate(
                    "Order not confirmed. Please contact the customer to secure a deposit.",
                    "الطلب غير مؤكَّد. يُرجى التواصل مع العميل لتأمين دفع العربون.",
                  )}
                </span>
              )}
            </Alert>

            {!order.isCodOrderConfirmed && (
              <div className="flex items-center gap-2">
                <Button fullWidth radius="md" variant="light" color="green" onClick={openConfirmCodModal}>
                  {translate("Mark as Confirmed?", "تأكيد الطلب؟")}
                </Button>

                <Button fullWidth radius="md" variant="light" color="dark" onClick={openCancelOrderModal}>
                  {translate("Cancel Order?", "إلغاء الطلب؟")}
                </Button>
              </div>
            )}

            <ConfirmCodModal opened={confirmCodModalOpened} close={closeConfirmCodModal} />
            <CancelOrderModal opened={cancelOrderModalOpened} close={closeCancelOrderModal} />
          </>
        )}
      </div>
    </div>
  );
}
