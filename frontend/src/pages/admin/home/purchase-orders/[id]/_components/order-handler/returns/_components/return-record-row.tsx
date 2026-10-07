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

  // Only used for display (SKU/title) - returnedQuantity/returnedAmount below come from
  // `returnRecord` itself, so a return record must still render even when the matching order item
  // can't be found or its product has since been deleted (docs section "do not silently hide
  // accounting information").
  const returnedItemData = order.items.find((item) => item.product?._id === returnRecord.productId);
  const product = returnedItemData?.product;

  return (
    <Table.Tr className="text-gray-600" h={42}>
      {/* Return Date */}
      <Table.Td>{formatDate(returnRecord.createdAt, language)}</Table.Td>
      {/* SKU */}
      <Table.Td>{product?.sku || "-"}</Table.Td>
      {/* Product Title */}
      <Table.Td className="font-bold text-gray-800">
        {product ? (
          <Link
            target="_blank"
            to={`/${paths.admin}/${paths.home}/${paths.products}/${product._id}`}
            className="hover:underline"
          >
            {translate(product.title.en, product.title.ar)}
          </Link>
        ) : (
          <span className="text-gray-500">{translate("Deleted Product", "منتج محذوف")}</span>
        )}
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
