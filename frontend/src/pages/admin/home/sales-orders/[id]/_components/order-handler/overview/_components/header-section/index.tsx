import { useLanguage } from "@/context/LanguageContext";
import { formatDateAndTime } from "@/utils/helpers/date-formaters";
import paths from "@/utils/constants/paths";
import { Link } from "react-router-dom";
import { Button, Menu } from "@mantine/core";
import { outlineIcons } from "@/components/icons";
import { useOrder } from "../../../../../context";
import PrintInvoice from "./_components/print-invoice";
import PrintReceipt from "./_components/print-receipt";
import InfoItem from "@/components/ui/info-item";
import OrderAmounts from "@/components/global/order-amounts";
import OrderStatus from "@/components/global/order-status";
import { isDeliveredOrder, isPendingOrder } from "@/utils/constants/order-statuses";
import { useDisclosure } from "@mantine/hooks";
import DeliveryModal from "./_components/delivery-modal";

export default function HeaderSection() {
  const { translate, language, translations } = useLanguage();
  const { order, orderPaymentStatusElement } = useOrder();

  const [deliveryModalOpened, { open: openDeliveryModal, close: closeDeliveryModal }] = useDisclosure();

  return (
    <header className="flex flex-wrap items-start justify-between gap-2">
      <div className="flex flex-col gap-2">
        <h1>{translate("Overview", "نظرة عامة")}</h1>
        <InfoItem label={translate("Order ID", "رقم الطلب")} value={order._id} />
        <InfoItem label={translate("Payment Status", "حالة الدفع")} value={orderPaymentStatusElement} />
        <OrderAmounts order={order} />
        {order.project && (
          <InfoItem label={translate("Project", "المشروع")} value={order.project.projectNumber || "-"} />
        )}
        {order.paymentMethod === "account" && order.paymentAccount && (
          <InfoItem
            label={translate("Payment Account", "حساب الدفع")}
            value={`${order.paymentAccount.code} - ${order.paymentAccount.name}`}
          />
        )}
        {order.paymentMethod === "advanced_payment" && (
          <InfoItem label={translate("Payment Account", "حساب الدفع")} value={translate("Advanced Payment", "دفعة مقدمة")} />
        )}
        {/* Orders are no longer given a payment method at creation; only an older COD order shows it. */}
        {order.isCodOrder && (
          <InfoItem label={translate("Payment Method", "طريقة الدفع")} value={translate("Cash on Delivery (COD)", "الدفع عند الاستلام")} />
        )}
        <InfoItem
          label={translate("Paid Amount", "المبلغ المدفوع")}
          value={`${order.paidAmount.toFixed(2)} ${translations.currency}`}
        />
        {order.remainingAmount > 0 && (
          <InfoItem
            label={translate("Remaining Amount", "المبلغ المتبقي")}
            value={`${order.remainingAmount.toFixed(2)} ${translations.currency}`}
          />
        )}
        {/* Shipping cost is no longer part of Sales Orders. Only older orders that were created with
            shipping (and so started as "pending") still show their delivery status. */}
        {(isPendingOrder(order.orderStatus) || (order.deliveryDate && order.shippingCost > 0)) && (
          <>
            <div className="flex items-center gap-2">
              <InfoItem label={translate("Order Status", "حالة الطلب")} value={<OrderStatus order={order} />} />
              {isPendingOrder(order.orderStatus) && (
                <>
                  <span className="text-gray-800">-</span>
                  <button className="text-sm font-medium text-blue-500 hover:underline" onClick={openDeliveryModal}>
                    {translate("Mark as Delivered?", "تأكيد التوصيل؟")}
                  </button>
                </>
              )}
            </div>
            {order.deliveryDate && isDeliveredOrder(order.orderStatus) && (
              <InfoItem
                label={translate("Delivery Date", "تاريخ التوصيل")}
                value={formatDateAndTime(order.deliveryDate, language)}
              />
            )}
          </>
        )}
        <InfoItem
          label={translate("Order Created At", "تم انشاء الطلب في")}
          value={formatDateAndTime(order.createdAt, language)}
        />
        {order.createdBy && (
          <InfoItem
            label={translate("Order Created By", "تم انشاء الطلب بواسطة")}
            value={
              <Link to={`/${paths.admin}/${paths.users}/${order.createdBy._id}`} className="hover:underline">
                {order.createdBy.name}
              </Link>
            }
          />
        )}
      </div>

      {/* Printing */}
      <div className="flex flex-col gap-2">
        <Menu withArrow width={150} radius={7.5} shadow="md">
          <Menu.Target>
            <Button color="dark" variant="light" radius="md" leftSection={<outlineIcons.Print size={18} />}>
              {translate("Print", "طباعة")}
            </Button>
          </Menu.Target>

          <Menu.Dropdown dir={translations.dir}>
            <PrintInvoice />
            <PrintReceipt />
          </Menu.Dropdown>
        </Menu>
      </div>

      <DeliveryModal opened={deliveryModalOpened} close={closeDeliveryModal} />
    </header>
  );
}
