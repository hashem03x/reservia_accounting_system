import { Payment } from "@/types/payment";
import { useLanguage } from "@/context/LanguageContext";
import { solidIcons } from "@/components/icons";

export default function PaymentAmount({ payment }: { payment: Payment }) {
  const { translations } = useLanguage();

  return (
    <div className={`flex items-center gap-1 font-bold ${payment.type === "in" ? "text-green-600" : "text-red-600"}`}>
      {payment.type === "in" ? <solidIcons.Plus size={10} /> : <solidIcons.Minus size={10} />}
      {payment.amountPaid.toFixed(2)} {translations.currency}
    </div>
  );
}
