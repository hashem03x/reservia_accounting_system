import { useLanguage } from "@/context/LanguageContext";
import { solidIcons } from "@/components/icons";
import { Table, Tooltip } from "@mantine/core";
import { useOrder } from "../../../../../context";
import StaticOrderItemRow from "./_components/static-order-item-row";

export default function OrderItemsSection() {
  const { translate } = useLanguage();

  const { order, returnRecords } = useOrder();

  const isThereAnyReturningRequest = order.items.some((item) => item.quantityToBeReturned > 0);

  return (
    <section className="flex flex-col gap-2">
      <header className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-gray-100 px-3 py-2">
        <h3>{translate("Order Items", "عناصر الطلب")}</h3>
        {order.couponDiscount > 0 && (
          <Tooltip
            withArrow
            label={translate(
              `The customer used a discount coupon, securing an additional ${order.couponDiscount}% off on their order.`,
              `استخدم العميل كوبون خصم ليحصل على خصم إضافي بنسبة ${order.couponDiscount}% على طلبه.`,
            )}
          >
            <div className="flex items-center gap-1.5 text-green-500">
              <span className="text-sm font-semibold">{`${order.couponDiscount}%`}</span>
              <solidIcons.Tag />
            </div>
          </Tooltip>
        )}
      </header>

      <div className="overflow-x-auto rounded-md border">
        <Table className="text-nowrap text-sm" withColumnBorders verticalSpacing={1.5}>
          <Table.Thead>
            <Table.Tr h={40} className="text-gray-800">
              <Table.Th w={150}>{translate("Variant Code", "كود الصنف")}</Table.Th>
              <Table.Th w={175}>{translate("Product Title", "عنوان المنتج")}</Table.Th>
              <Table.Th w={100}>{translate("Color", "اللون")}</Table.Th>
              <Table.Th w={100}>{translate("Size", "المقاس")}</Table.Th>
              <Table.Th w={100}>{translate("Quantity", "الكمية")}</Table.Th>
              <Table.Th w={125}>{translate("Returned", "مرتجع")}</Table.Th>
              <Table.Th w={125}>{translate("Unit Price", "سعر الوحدة")}</Table.Th>
              <Table.Th w={150} className="min-w-[150px]">
                {translate("Discount", "الخصم")}
              </Table.Th>
              <Table.Th w={125}>{translate("After Discount", "بعد الخصم")}</Table.Th>
              <Table.Th w={125}>{translate("Subtotal", "المجموع")}</Table.Th>
              {isThereAnyReturningRequest && <Table.Th w={10} />}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {order.items.map((_, index) => (
              <StaticOrderItemRow key={index} index={index} />
            ))}
          </Table.Tbody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        {returnRecords.length > 0 ? (
          <div className="flex items-center gap-2">
            <solidIcons.ExclamationCircle size={12} className="text-yellow-500" />
            <p className="text-xs md:text-sm">
              {translate(`Some items have been returned in this order.`, `لقد تم إرجاع بعض العناصر في هذا الطلب.`)}
            </p>
          </div>
        ) : null}

        <p className="text-xs text-gray-500 md:text-sm">
          {translate("Total Sold Items", "إجمالي العناصر المباعة")}:{" "}
          {order.items.reduce((acc, item) => acc + (item.starterQuantity - item.returnedQuantity), 0)}
        </p>
      </div>
    </section>
  );
}
