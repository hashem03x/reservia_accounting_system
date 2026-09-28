import { SalesOrder } from "@/types/orders";
import { useLanguage } from "@/context/LanguageContext";
import { getPaymentStatusLabel, isPaid, isUnpaid } from "@/utils/constants/payment-statuses";
import { solidIcons } from "@/components/icons";

export default function OrderPaymentStatus({ order }: { order: SalesOrder }) {
  const { language } = useLanguage();

  const paymentStatus = order.paymentStatus;

  return (
    <div className="flex items-center gap-1.5">
      {isPaid(paymentStatus) ? (
        <solidIcons.CheckCircle className="text-green-500" />
      ) : isUnpaid(paymentStatus) ? (
        <solidIcons.XmarkCircle className="text-red-500" />
      ) : (
        <solidIcons.Circle className="text-orange-500" />
      )}
      <span className="font-bold text-gray-800">{getPaymentStatusLabel(paymentStatus, language)}</span>
    </div>
  );
}
