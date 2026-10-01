import { useLanguage } from "@/context/LanguageContext";
import { formatDate } from "@/utils/helpers/date-formaters";
import paths from "@/utils/constants/paths";
import { Link } from "react-router-dom";
import { Table } from "@mantine/core";
import { useOrder } from "../../../../context";
import { ReturnRecord } from "@/types/orders";

export default function ReturnRecordRow({ returnRecord }: { returnRecord: ReturnRecord }) {
  const { translate, language, translations } = useLanguage();

  const { order } = useOrder();

  const returnedItemData = order.items.find((item) => item.product._id === returnRecord.productId);
  if (!returnedItemData) return null;

  return (
    <Table.Tr className="text-gray-600" h={42}>
      {/* Return Date */}
      <Table.Td>{formatDate(returnRecord.createdAt, language)}</Table.Td>
      {/* SKU */}
      <Table.Td>{returnedItemData.product.sku}</Table.Td>
      {/* Product Title */}
      <Table.Td className="font-bold text-gray-800">
        <Link
          target="_blank"
          to={`/${paths.admin}/${paths.home}/${paths.products}/${returnedItemData.product._id}`}
          className="hover:underline"
        >
          {translate(returnedItemData.product.title.en, returnedItemData.product.title.ar)}
        </Link>
      </Table.Td>
      {/* Quantity Returned */}
      <Table.Td className="font-bold text-gray-800">{returnRecord.returnedQuantity}</Table.Td>
      {/* Amount */}
      <Table.Td className="font-bold text-gray-800">
        {returnRecord.returnedAmount.toFixed(2)} {translations.currency}
      </Table.Td>
    </Table.Tr>
  );
}
