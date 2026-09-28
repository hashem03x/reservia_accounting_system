import { useLanguage } from "@/context/LanguageContext";
import { getColorLabel } from "@/utils/constants/colors";
import { formatDate } from "@/utils/helpers/date-formaters";
import paths from "@/utils/constants/paths";
import { Link } from "react-router-dom";
import { Table } from "@mantine/core";
import { useOrder } from "../../../../context";
import { ReturnRecord } from "@/types/orders";

export default function ReturnRecordRow({ returnRecord }: { returnRecord: ReturnRecord }) {
  const { translate, language, translations } = useLanguage();

  const { order } = useOrder();

  const returnedItemData = order.items.find((item) => item.variant._id === returnRecord.variantId);
  if (!returnedItemData) return null;

  return (
    <Table.Tr className="text-gray-600" h={42}>
      {/* Return Date */}
      <Table.Td>{formatDate(returnRecord.createdAt, language)}</Table.Td>
      {/* Variant Code */}
      <Table.Td>{returnedItemData.variant.variantCode}</Table.Td>
      {/* Product Title */}
      <Table.Td className="font-bold text-gray-800">
        <Link
          target="_blank"
          to={`/${paths.admin}/${paths.home}/${paths.products}/${returnedItemData.variant.product._id}`}
          className="hover:underline"
        >
          {translate(returnedItemData.variant.product.title.en, returnedItemData.variant.product.title.ar)}
        </Link>
      </Table.Td>
      {/* Color */}
      <Table.Td>{getColorLabel(returnedItemData.variant.color, language)}</Table.Td>
      {/* Size */}
      <Table.Td>{returnedItemData.variant.size}</Table.Td>
      {/* Quantity Returned */}
      <Table.Td className="font-bold text-gray-800">{returnRecord.returnedQuantity}</Table.Td>
      {/* Amount */}
      <Table.Td className="font-bold text-gray-800">
        {returnRecord.returnedAmount.toFixed(2)} {translations.currency}
      </Table.Td>
    </Table.Tr>
  );
}
