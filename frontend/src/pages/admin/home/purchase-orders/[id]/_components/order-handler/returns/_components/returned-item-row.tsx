import { useLanguage } from "@/context/LanguageContext";
import { getColorLabel } from "@/utils/constants/colors";
import { PurchaseOrderItem } from "@/types/orders";
import paths from "@/utils/constants/paths";
import { Link } from "react-router-dom";
import { Table } from "@mantine/core";

export default function ReturnedItemRow({ returnedItem }: { returnedItem: PurchaseOrderItem }) {
  const { translate, language, translations } = useLanguage();

  return (
    <Table.Tr className="text-gray-600" h={42}>
      {/* Variant Code */}
      <Table.Td>{returnedItem.variant.variantCode}</Table.Td>
      {/* Product Title */}
      <Table.Td className="font-bold text-gray-800">
        <Link
          target="_blank"
          to={`/${paths.admin}/${paths.home}/${paths.products}/${returnedItem.variant.product._id}`}
          className="hover:underline"
        >
          {translate(returnedItem.variant.product.title.en, returnedItem.variant.product.title.ar)}
        </Link>
      </Table.Td>
      {/* Color */}
      <Table.Td>{getColorLabel(returnedItem.variant.color, language)}</Table.Td>
      {/* Size */}
      <Table.Td>{returnedItem.variant.size}</Table.Td>
      {/* Price After Discount */}
      <Table.Td>
        {returnedItem.unitPriceAfterDiscount.toFixed(2)} {translations.currency}
      </Table.Td>
      {/* Quantity Returned */}
      <Table.Td className="font-bold text-gray-800">{returnedItem.returnedQuantity}</Table.Td>
      {/* Amount Returned */}
      <Table.Td className="font-bold text-gray-800">
        {(returnedItem.returnedQuantity * returnedItem.unitPriceAfterDiscount).toFixed(2)} {translations.currency}
      </Table.Td>
    </Table.Tr>
  );
}
