import { useLanguage } from "@/context/LanguageContext";
import { getColorLabel } from "@/utils/constants/colors";
import paths from "@/utils/constants/paths";
import { Link } from "react-router-dom";
import { Table } from "@mantine/core";
import { useOrder } from "../../../../../../context";

export default function StaticOrderItemRow({ index }: { index: number }) {
  const { translate, language, translations } = useLanguage();
  const { order: currentOrder } = useOrder();
  if (!currentOrder) return null;
  const currentItem = currentOrder.items[index];
  if (!currentItem) return null; // Important: Prevent errors when switching from "Creating" mode to "Reading" mode.

  return (
    <Table.Tr className="text-gray-600" h={40}>
      {/* Variant Code */}
      <Table.Td>{currentItem.variant.variantCode}</Table.Td>
      {/* Product Title */}
      <Table.Td className="font-bold text-gray-800">
        <Link
          target="_blank"
          to={`/${paths.admin}/${paths.home}/${paths.products}/${currentItem.variant.product._id}`}
          className="hover:underline"
        >
          {translate(currentItem.variant.product.title.en, currentItem.variant.product.title.ar)}
        </Link>
      </Table.Td>
      {/* Color */}
      <Table.Td>{getColorLabel(currentItem.variant.color, language)}</Table.Td>
      {/* Size */}
      <Table.Td>{currentItem.variant.size}</Table.Td>
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
