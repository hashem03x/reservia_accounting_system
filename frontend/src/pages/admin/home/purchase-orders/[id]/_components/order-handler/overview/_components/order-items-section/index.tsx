import { useLanguage } from "@/context/LanguageContext";
import { solidIcons } from "@/components/icons";
import { Table } from "@mantine/core";
import { useOrder } from "../../../../../context";
import StaticOrderItemRow from "./_components/static-order-item-row";

export default function OrderItemsSection() {
  const { translate } = useLanguage();

  const { order, returnRecords } = useOrder();

  return (
    <section className="flex flex-col gap-2">
      <header className="rounded-md bg-gray-100 px-3 py-2">
        <h3>{translate("Order Items", "عناصر الطلب")}</h3>
      </header>

      <div className="overflow-x-auto rounded-md border">
        <Table className="text-nowrap text-sm" withColumnBorders verticalSpacing={1.5}>
          <Table.Thead>
            <Table.Tr h={40} className="text-gray-800">
              <Table.Th w={150}>{translate("SKU", "رمز المنتج")}</Table.Th>
              <Table.Th w={175}>{translate("Product Title", "عنوان المنتج")}</Table.Th>
              <Table.Th w={100}>{translate("Quantity", "الكمية")}</Table.Th>
              <Table.Th w={125}>{translate("Returned", "مرتجع")}</Table.Th>
              <Table.Th w={125}>{translate("Unit Price", "سعر الوحدة")}</Table.Th>
              <Table.Th w={150} className="min-w-[150px]">
                {translate("Discount", "الخصم")}
              </Table.Th>
              <Table.Th w={125}>{translate("After Discount", "بعد الخصم")}</Table.Th>
              <Table.Th w={125}>{translate("Subtotal", "المجموع")}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {order.items.map((_, index) => (
              <StaticOrderItemRow key={index} index={index} />
            ))}
          </Table.Tbody>
        </Table>
      </div>

      {returnRecords.length > 0 && (
        <div className="flex items-center gap-2">
          <solidIcons.ExclamationCircle size={12} className="text-yellow-500" />
          <p className="text-xs md:text-sm">
            {translate(`Some items have been returned in this order.`, `لقد تم إرجاع بعض العناصر في هذا الطلب.`)}
          </p>
        </div>
      )}
    </section>
  );
}
