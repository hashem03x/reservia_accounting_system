import { useLanguage } from "@/context/LanguageContext";
import InfoItem from "@/components/ui/info-item";
import { OrderFinancials } from "@/types/orders";
import { getOrderSubtotal, getOrderTotal } from "@/utils/helpers/order-totals";

/**
 * The money summary shared by the Sales Order and Purchase Order detail pages. "Order Total Amount"
 * is the canonical order amount (grandTotal = subtotal + VAT - withholding, persisted by the
 * backend). The subtotal is only shown when it differs, and a VAT/withholding line only when that
 * tax is actually non-zero - an order with no taxes never shows a tax line.
 */
export default function OrderAmounts({ order }: { order: OrderFinancials & { totalAmount?: number | null } }) {
  const { translate, translations } = useLanguage();
  const total = getOrderTotal(order);
  const subtotal = getOrderSubtotal(order);
  const vatAmount = order.vatAmount || 0;
  const withholdingTaxAmount = order.withholdingTaxAmount || 0;
  const money = (n: number) => `${n.toFixed(2)} ${translations.currency}`;

  return (
    <>
      <InfoItem label={translate("Order Total Amount", "إجمالي مبلغ الطلب")} value={money(total)} />
      {subtotal !== total && <InfoItem label={translate("Subtotal (before tax)", "الإجمالي قبل الضريبة")} value={money(subtotal)} />}
      {vatAmount > 0 && (
        <InfoItem label={translate("VAT", "ضريبة القيمة المضافة")} value={`(${order.vatPercentage || 0}%) ${money(vatAmount)}`} />
      )}
      {withholdingTaxAmount > 0 && (
        <InfoItem
          label={translate("Withholding Tax", "ضريبة الخصم")}
          value={`(${order.withholdingTaxPercentage || 0}%) -${money(withholdingTaxAmount)}`}
        />
      )}
    </>
  );
}
