import { SalesOrder } from "@/types/orders";
import { useLanguage } from "@/context/LanguageContext";
import { getOrderStatusLabel, isCanceledOrder, isDeliveredOrder, isPendingOrder } from "@/utils/constants/order-statuses";
import { solidIcons, outlineIcons } from "@/components/icons";

export default function OrderStatus({ order }: { order: SalesOrder }) {
  const { language } = useLanguage();

  const orderStatus = order.orderStatus;

  if (!orderStatus) return null;

  return (
    <div className="flex items-center gap-1.5">
      {isPendingOrder(orderStatus) ? (
        <outlineIcons.Clock className="text-orange-500" />
      ) : isDeliveredOrder(orderStatus) ? (
        <solidIcons.CheckCircle className="text-green-500" />
      ) : isCanceledOrder(orderStatus) ? (
        <solidIcons.XmarkCircle className="text-red-500" />
      ) : null}
      <span className="font-bold text-gray-800">{getOrderStatusLabel(orderStatus, language)}</span>
    </div>
  );
}
