import { useLanguage } from "@/context/LanguageContext";
import paths from "@/utils/constants/paths";
import { Link } from "react-router-dom";
import { Table } from "@mantine/core";
import { useOrder } from "../../../../../../context";

export default function StaticOrderItemRow({ index }: { index: number }) {
  const { translate, translations } = useLanguage();
  const { order: currentOrder } = useOrder();
  if (!currentOrder) return null;
  const currentItem = currentOrder.items[index];
  if (!currentItem) return null; // Important: Prevent errors when switching from "Creating" mode to "Reading" mode.

  return (
    <Table.Tr className="text-gray-600" h={40}>
      {/* SKU */}
      <Table.Td>{currentItem.product.sku}</Table.Td>
      {/* Product Title */}
      <Table.Td className="font-bold text-gray-800">
        <Link
          target="_blank"
          to={`/${paths.admin}/${paths.home}/${paths.products}/${currentItem.product._id}`}
          className="hover:underline"
        >
          {translate(currentItem.product.title.en, currentItem.product.title.ar)}
        </Link>
      </Table.Td>
      {/* Quantity */}
      <Table.Td>{currentItem.starterQuantity}</Table.Td>
      {/* Returned */}
      <Table.Td>{currentItem.returnedQuantity}</Table.Td>
      {/* Unit Price */}
      <Table.Td>
        {currentItem.unitPrice.toFixed(2)} {translations.currency}
      </Table.Td>
      {/* Discount */}
      <Table.Td>
        {currentItem.itemDiscount.value > 0 ? (
          <div className="flex items-center gap-1">
            {currentItem.itemDiscount.type === "percentage" ? (
              <span>{currentItem.itemDiscount.value}%</span>
            ) : (
              <span>
                {currentItem.itemDiscount.value.toFixed(2)} {translations.currency}
              </span>
            )}
          </div>
        ) : (
          <p className="text-xs sm:text-sm">{translate("No Discount", "لا يوجد خصم")}</p>
        )}
      </Table.Td>
      {/* Unit Price After Discount */}
      <Table.Td>
        {currentItem.unitPriceAfterDiscount.toFixed(2)} {translations.currency}
      </Table.Td>
      {/* Subtotal */}
      <Table.Td className="font-bold text-gray-800">
        {currentItem.subtotal.toFixed(2)} {translations.currency}
      </Table.Td>
    </Table.Tr>
  );
}
