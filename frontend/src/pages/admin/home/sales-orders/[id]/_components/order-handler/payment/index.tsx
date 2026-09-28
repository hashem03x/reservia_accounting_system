import { useDisclosure } from "@mantine/hooks";
import { useLanguage } from "@/context/LanguageContext";
import { formatDateAndTime } from "@/utils/helpers/date-formaters";
import { getPaymentCategoryLabel } from "@/utils/constants/payment-category";
import { getPaymentMethodLabel } from "@/utils/constants/payment-methods";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import PaymentAmount from "@/components/ui/payment-amount";
import { solidIcons } from "@/components/icons";
import { Button, Table } from "@mantine/core";
import { useOrder } from "../../../context";
import AddPaymentModal from "./_components/add-payment-modal";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { notifyError } from "@/utils/helpers/notifiers";
import PayAllModal from "./_components/pay-all-modal";

export default function Payment() {
  const { translate, language, translations } = useLanguage();
  const { order, payments, orderPaymentStatusElement, setOrder } = useOrder();
  const [opened, { open, close }] = useDisclosure(false);

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  if (error) {
    notifyError({ language, message: error });
    setError("");
  }

  async function setShippingCostAsPaid() {
    handleRequest(language, setLoading, setError, async () => {
      const { data } = await privateRequest({
        method: "PATCH",
        url: `sale-orders/${order._id}/pay-shipping-cost`,
        language,
      });
      setOrder(data);
    });
  }

  const [payAllModalOpened, { open: openPayAllModal, close: closePayAllModal }] = useDisclosure(false);

  return (
    <AdminLayoutBox
      header={{
        title: translate("Payments", "الدفعات"),
        sideElements: (
          <>
            {order.remainingAmount !== 0 || (order.shippingCost > 0 && !order.shippingCostPaid) ? (
              <Button radius="md" onClick={openPayAllModal}>
                {translate("Pay All", "دفع الكل")}
              </Button>
            ) : null}

            <PayAllModal opened={payAllModalOpened} close={closePayAllModal} />
          </>
        ),
      }}
    >
      <div className="flex flex-col gap-6">
        <section>
          <div className="overflow-x-auto rounded-md border">
            <Table className="text-nowrap text-sm" withColumnBorders verticalSpacing="xs">
              <Table.Thead className="bg-gray-100 text-gray-800">
                <Table.Tr>
                  <Table.Th>{translate("Payment Status", "حالة الدفع")}</Table.Th>
                  <Table.Th>{translate("Total Paid", "المبلغ المدفوع")}</Table.Th>
                  <Table.Th>{translate("Remaining Amount", "المبلغ المتبقي")}</Table.Th>
                  <Table.Th>{translate("Order Total Amount", "اجمالي سعر الطلب")}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                <Table.Tr className="text-gray-800">
                  <Table.Td>{orderPaymentStatusElement}</Table.Td>
                  <Table.Td>
                    {order.paidAmount.toFixed(2)} {translations.currency}
                  </Table.Td>
                  <Table.Td>
                    {order.remainingAmount.toFixed(2)} {translations.currency}
                  </Table.Td>
                  <Table.Td>
                    {order.totalAmount.toFixed(2)} {translations.currency}
                  </Table.Td>
                </Table.Tr>
              </Table.Tbody>
            </Table>
          </div>
        </section>

        <hr />

        <section className="flex flex-col gap-1.5">
          <h4>{translate("Payment Transaction History", "سجل معاملات الدفع")}</h4>
          {payments.length === 0 ? (
            <p className="">{translate("No payments have been made yet.", "لم يتم اصدار دفعات حتى الآن.")}</p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table className="text-nowrap text-sm" withColumnBorders verticalSpacing="xs">
                <Table.Thead className="bg-gray-100 text-gray-800">
                  <Table.Tr>
                    <Table.Th>{translate("Date & Time", "التاريخ والوقت")}</Table.Th>
                    <Table.Th>{translate("Amount Paid", "المبلغ المدفوع")}</Table.Th>
                    <Table.Th>{translate("Payment Method", "طريقة الدفع")}</Table.Th>
                    <Table.Th>{translate("Payment Category", "التصنيف")}</Table.Th>
                    <Table.Th>{translate("Notes", "ملاحظات")}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody className="text-gray-800">
                  {payments.map((payment) => (
                    <Table.Tr key={payment._id}>
                      <Table.Td>{formatDateAndTime(payment.createdAt, language)}</Table.Td>
                      <Table.Td>
                        <PaymentAmount payment={payment} />
                      </Table.Td>
                      <Table.Td>{getPaymentMethodLabel(payment.paymentMethod, language)}</Table.Td>
                      <Table.Td>{getPaymentCategoryLabel(payment.paymentCategory, language)}</Table.Td>
                      <Table.Td>{payment.notes}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </div>
          )}

          <div className="mt-1.5">
            {order.remainingAmount !== 0 && (
              <Button onClick={open} radius="md" leftSection={<solidIcons.Plus />}>
                {translate("Add Payment", "اضافة دفعة")}
              </Button>
            )}

            <AddPaymentModal opened={opened} close={close} />
          </div>
        </section>

        {/* Shipping Cost */}
        {order.shippingCost > 0 && (
          <>
            <hr />
            <section className="flex flex-col gap-1.5">
              <h4>{translate("Shipping Cost", "تكلفة الشحن")}</h4>
              <div className="flex items-center gap-1.5 text-xs md:text-sm">
                <span className="text-gray-600">{translate("Shipping Cost", "تكلفة الشحن")}:</span>
                <span className="font-bold text-gray-800">{`${order.shippingCost.toFixed(2)} ${translations.currency}`}</span>
              </div>
              <div className="flex items-center gap-1.5 text-xs md:text-sm">
                <span className="text-gray-600">{translate("Shipping Cost Paid?", "تم دفع تكلفة الشحن؟")}</span>
                <span
                  className={`font-bold ${order.shippingCostPaid ? "text-green-600" : "text-red-600"}`}
                >{`${order.shippingCostPaid ? translate("Yes", "نعم") : translate("No", "لا")}`}</span>

                {!order.shippingCostPaid && (
                  <>
                    <span className="text-gray-800">-</span>
                    <button
                      className={`text-sm font-medium ${loading ? "cursor-not-allowed text-gray-600" : "text-blue-500 hover:underline"}`}
                      onClick={setShippingCostAsPaid}
                      disabled={loading}
                    >
                      {translate("Set as Paid", "تأكيد الدفع")}
                    </button>
                  </>
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </AdminLayoutBox>
  );
}
