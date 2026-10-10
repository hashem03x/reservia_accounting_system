import { Link } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import { formatDateAndTime } from "@/utils/helpers/date-formaters";
import { getPaymentMethodLabel } from "@/utils/constants/payment-methods";
import { Payment } from "@/types/payment";
import paths from "@/utils/constants/paths";
import PaymentAmount from "@/components/ui/payment-amount";
import { Table } from "@mantine/core";
import { getPaymentCategoryLabel } from "@/utils/constants/payment-category";

export default function VendorPaymentsHistory({ payments }: { payments: Payment[] }) {
  const { language, translate } = useLanguage();

  return (
    <div className="flex flex-col gap-3">
      <h4>{translate("Payments History", "سجل الدفعات")}</h4>
      <div className="overflow-x-auto rounded-lg bg-white p-1.5 dark:bg-gray-800">
        <Table className="text-nowrap text-sm" withColumnBorders verticalSpacing="xs">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{translate("Order ID", "رقم الطلب")}</Table.Th>
              <Table.Th>{translate("Date & Time", "التاريخ والوقت")}</Table.Th>
              <Table.Th>{translate("Amount Paid", "المبلغ المدفوع")}</Table.Th>
              <Table.Th>{translate("Payment Method", "طريقة الدفع")}</Table.Th>
              <Table.Th>{translate("Payment Category", "التصنيف")}</Table.Th>
              <Table.Th>{translate("Notes", "ملاحظات")}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {payments.map((payment) => (
              <Table.Tr key={payment._id}>
                <Table.Td className="font-bold">
                  {/* Only Purchase Order payments have an order - expense and fixed asset payments do not. */}
                  {payment.purchaseOrderId ? (
                    <Link
                      className="hover:underline"
                      to={`/${paths.admin}/${paths.home}/${paths.purchaseOrders}/${payment.purchaseOrderId}`}
                    >
                      {payment.purchaseOrderId}
                    </Link>
                  ) : (
                    "-"
                  )}
                </Table.Td>
                <Table.Td>{formatDateAndTime(payment.createdAt, language)}</Table.Td>
                <Table.Td>
                  <PaymentAmount payment={payment} />
                </Table.Td>
                <Table.Td>
                  {payment.paymentAccount
                    ? `${payment.paymentAccount.code} - ${(language === "ar-EG" && payment.paymentAccount.nameAr) || payment.paymentAccount.name}`
                    : getPaymentMethodLabel(payment.paymentMethod, language)}
                </Table.Td>
                <Table.Td>{getPaymentCategoryLabel(payment.paymentCategory, language)}</Table.Td>
                <Table.Td>{payment.notes}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </div>
    </div>
  );
}
