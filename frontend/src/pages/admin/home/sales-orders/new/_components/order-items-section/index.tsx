import { useLanguage } from "@/context/LanguageContext";
import paths from "@/utils/constants/paths";
import { Link } from "react-router-dom";
import { Button, Table } from "@mantine/core";
import { solidIcons } from "@/components/icons";
import { OrderItemInput } from "../../types";
import OrderItemRow from "./_components/order-item-row";

export default function OrderItemsSection({
  items,
  setItems,
  addNewItem,
  warehouseId,
}: {
  items: OrderItemInput[];
  setItems: React.Dispatch<React.SetStateAction<OrderItemInput[]>>;
  addNewItem: () => void;
  warehouseId: string;
}) {
  const { translate } = useLanguage();

  const asterisk = <span className="text-red-600">*</span>;

  return (
    <section className="flex flex-col gap-2">
      <header className="rounded-md bg-gray-100 px-3 py-2">
        <h3>{translate("Order Items", "عناصر الطلب")}</h3>
      </header>

      {/* Table */}
      <div className="overflow-x-auto rounded-md border">
        <Table className="text-nowrap text-sm" withColumnBorders verticalSpacing={1.5}>
          <Table.Thead>
            <Table.Tr h={40} className="text-gray-800">
              <Table.Th w={165} className="min-w-[165px]">
                {translate("Barcode", "الباركود")} {asterisk}
              </Table.Th>
              <Table.Th w={175} className="min-w-[175px]">
                {translate("Product Title", "عنوان المنتج")}
              </Table.Th>
              <Table.Th w={100} className="min-w-[100px]">
                {translate("Quantity", "الكمية")} {asterisk}
              </Table.Th>
              <Table.Th w={100} className="min-w-[100px]">
                {translate("Unit Price", "سعر الوحدة")} {asterisk}
              </Table.Th>
              <Table.Th w={150} className="min-w-[150px]">
                {translate("Discount", "الخصم")}
              </Table.Th>
              <Table.Th w={125} className="min-w-[125px]">
                {translate("After Discount", "بعد الخصم")}
              </Table.Th>
              <Table.Th w={125} className="min-w-[125px]">
                {translate("Subtotal", "المجموع")}
              </Table.Th>
              {items.length > 1 && <Table.Th w={45}></Table.Th>}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {items.map((_, index) => (
              <OrderItemRow
                key={index}
                index={index}
                items={items}
                setItems={setItems}
                addNewItem={addNewItem}
                warehouseId={warehouseId}
              />
            ))}
          </Table.Tbody>
        </Table>
      </div>

      {/* Add Item Button */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <Button onClick={addNewItem} variant="light" leftSection={<solidIcons.Plus />}>
          {translate("Add Item", "اضافة عنصر")}
        </Button>
        <Link
          target="_blank"
          to={`/${paths.admin}/${paths.home}/${paths.products}`}
          className="flex items-center gap-1.5 text-xs text-blue-500 hover:underline md:text-sm"
        >
          <solidIcons.ExternalLink size={12} />
          {translate("View Products List", "عرض قائمة المنتجات")}
        </Link>
      </div>
    </section>
  );
}
