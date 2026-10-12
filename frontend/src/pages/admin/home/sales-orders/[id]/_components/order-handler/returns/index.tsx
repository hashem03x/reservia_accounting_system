import { useState } from "react";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import useHasPermission from "@/hooks/useHasPermission";
import resources from "@/utils/constants/resources";
import actions from "@/utils/constants/actions";
import ReturnOrderModal from "@/components/global/reversals/return-order-modal";
import ReversalHistory from "@/components/global/reversals/reversal-history";
import { useDisclosure } from "@mantine/hooks";
import { useLanguage } from "@/context/LanguageContext";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import EmptySection from "@/components/ui/sections/empty";
import { Button, Table } from "@mantine/core";
import { useOrder } from "../../../context";
import ReturnRecordRow from "./_components/return-record-row";
import ReturnedItemRow from "./_components/returned-item-row";

export default function Returns() {
  const { translate, language } = useLanguage();
  const { order, setOrder, setPayments, returnRecords, setReturnRecords, returnedItems } = useOrder();
  const privateRequest = usePrivateRequest();
  const canReturn = useHasPermission(resources.salesOrders, actions.update);

  const [opened, { open, close }] = useDisclosure();
  const [historyKey, setHistoryKey] = useState(0);

  const lines = order.items
    .filter((item) => item.product)
    .map((item) => ({
      productId: item.product!._id,
      title: item.product!.title,
      ordered: item.starterQuantity,
      returned: item.returnedQuantity,
      unitPrice: item.unitPriceAfterDiscount,
      isService: item.product!.type === "service",
    }));
  const hasItemsToReturn = lines.some((l) => l.ordered - l.returned > 0);
  // An id, or the populated warehouse.
  const warehouse = order.warehouse as unknown as string | { _id: string } | null;

  // A return changes the order (totals, paid amount), may add a refund payment and adds return
  // records - all reloaded from the server, never guessed locally.
  async function refresh() {
    const [orderRes, paymentsRes, returnsRes] = await Promise.all([
      privateRequest({ url: `sale-orders/${order._id}`, language }),
      privateRequest({ url: "payment", params: { salesOrderId: order._id }, language }),
      privateRequest({ url: "sale-orders/returns", params: { salesOrderId: order._id }, language }),
    ]);
    setOrder(orderRes.data);
    setPayments(paymentsRes.data);
    setReturnRecords(returnsRes.data);
    setHistoryKey((k) => k + 1);
  }

  return (
    <AdminLayoutBox
      header={{
        title: translate("Returns", "المرتجعات"),
        sideElements: (
          <>
            {hasItemsToReturn && canReturn && (
              <Button onClick={open} radius="md" color="orange" variant="light">
                {translate("Return items", "إرجاع أصناف")}
              </Button>
            )}
            <ReturnOrderModal
              opened={opened}
              close={close}
              kind="sales"
              orderId={order._id}
              orderCode={(order as { code?: string }).code}
              lines={lines}
              defaultWarehouseId={typeof warehouse === "string" ? warehouse : warehouse?._id || null}
              paidAmount={order.paidAmount || 0}
              onDone={() => refresh()}
            />
          </>
        ),
      }}
    >
      {returnRecords.length > 0 ? (
        <>
          {returnedItems.length > 0 && (
            <section className="flex flex-col gap-2">
              <div className="overflow-x-auto rounded-md border">
                <Table className="text-nowrap text-sm" withColumnBorders verticalSpacing="xs">
                  <Table.Thead className="bg-gray-100 text-gray-800">
                    <Table.Tr>
                      <Table.Th>{translate("SKU", "رمز المنتج")}</Table.Th>
                      <Table.Th>{translate("Product Title", "عنوان المنتج")}</Table.Th>
                      <Table.Th>{translate("Price After Discount", "السعر بعد الخصم")}</Table.Th>
                      <Table.Th>{translate("Quantity Returned", "الكمية المرتجعة")}</Table.Th>
                      <Table.Th>{translate("Amount Returned", "المبلغ المرتجع")}</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {returnedItems.map((returnedItem) => (
                      <ReturnedItemRow key={returnedItem._id} returnedItem={returnedItem} />
                    ))}
                  </Table.Tbody>
                </Table>
              </div>
            </section>
          )}

          <hr className="my-2" />

          <section className="flex flex-col gap-2">
            <h4>{translate("Return Processes History", "سجل عمليات الارجاع")}</h4>
            <div className="overflow-x-auto rounded-md border">
              <Table className="text-nowrap text-sm" withColumnBorders verticalSpacing="xs">
                <Table.Thead className="bg-gray-100 text-gray-800">
                  <Table.Tr>
                    <Table.Th>{translate("Return Date", "تاريخ الارجاع")}</Table.Th>
                    <Table.Th>{translate("SKU", "رمز المنتج")}</Table.Th>
                    <Table.Th>{translate("Product Title", "عنوان المنتج")}</Table.Th>
                    <Table.Th>{translate("Quantity Returned", "الكمية المرتجعة")}</Table.Th>
                    <Table.Th>{translate("Amount Returned", "المبلغ المرتجع")}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {returnRecords.map((returnRecord) => (
                    <ReturnRecordRow key={returnRecord._id} returnRecord={returnRecord} />
                  ))}
                </Table.Tbody>
              </Table>
            </div>
          </section>
        </>
      ) : (
        <EmptySection message={translate("No Items Returned", "لا توجد مرتجعات")} useDefaultImg />
      )}
      <div className="mt-4">
        <ReversalHistory query={{ salesOrder: order._id }} refreshKey={historyKey} />
      </div>
    </AdminLayoutBox>
  );
}
