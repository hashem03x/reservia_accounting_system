import { useNavigate } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import { PurchaseOrder } from "@/types/orders";
import { getPaymentStatusLabel } from "@/utils/constants/payment-statuses";
import { formatDateAndTime } from "@/utils/helpers/date-formaters";
import paths from "@/utils/constants/paths";
import { Table } from "@mantine/core";
<<<<<<< HEAD
import { getOrderTotal } from "@/utils/helpers/order-totals";
=======
>>>>>>> 368811657e0eba1f2e8b46ee732d01745194d628

export default function VendorOrdersHistory({ orders }: { orders: PurchaseOrder[] }) {
  const { language, translate, translations } = useLanguage();

  const navigate = useNavigate();

  return (
    <div className="flex flex-col gap-3">
      <h4>{translate("Order History", "سجل الطلبات")}</h4>
      <div className="overflow-x-auto rounded-lg bg-white p-1.5">
        <Table className="text-nowrap" withColumnBorders verticalSpacing="xs" highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{translate("Order ID", "رقم الطلب")}</Table.Th>
              <Table.Th>{translate("Payment Status", "حالة الدفع")}</Table.Th>
              <Table.Th>{translate("Total Amount", "المبلغ الإجمالي")}</Table.Th>
              <Table.Th>{translate("Date & Time", "التاريخ والوقت")}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {orders.map((purchaseOrder) => (
              <Table.Tr
                key={purchaseOrder._id}
                className="cursor-pointer text-gray-600"
                onClick={() => navigate(`/${paths.admin}/${paths.home}/${paths.purchaseOrders}/${purchaseOrder._id}`)}
              >
                <Table.Td className="font-semibold text-gray-800">{purchaseOrder._id}</Table.Td>
                <Table.Td>{getPaymentStatusLabel(purchaseOrder.paymentStatus, language)}</Table.Td>
                <Table.Td className="font-semibold text-gray-800">
<<<<<<< HEAD
                  {getOrderTotal(purchaseOrder).toFixed(2)} {translations.currency}
=======
                  {purchaseOrder.totalAmount.toFixed(2)} {translations.currency}
>>>>>>> 368811657e0eba1f2e8b46ee732d01745194d628
                </Table.Td>
                <Table.Td>{formatDateAndTime(purchaseOrder.createdAt, language)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </div>
    </div>
  );
}
