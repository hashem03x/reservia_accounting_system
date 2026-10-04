import { useLanguage } from "@/context/LanguageContext";
import { SalesOrderItem } from "@/types/orders";
import paths from "@/utils/constants/paths";
import { Link } from "react-router-dom";
import { Table } from "@mantine/core";

export default function ReturnedItemRow({ returnedItem }: { returnedItem: SalesOrderItem }) {
  const { translate, translations } = useLanguage();

  return (
    <Table.Tr className="text-gray-600" h={42}>
      {/* SKU */}
      <Table.Td>{returnedItem.product?.sku || "-"}</Table.Td>
      {/* Product Title */}
      <Table.Td className="font-bold text-gray-800">
        {returnedItem.product ? (
          <Link
            target="_blank"
            to={`/${paths.admin}/${paths.home}/${paths.products}/${returnedItem.product._id}`}
            className="hover:underline"
          >
            {translate(returnedItem.product.title.en, returnedItem.product.title.ar)}
          </Link>
        ) : (
          <span className="text-gray-500">{translate("Deleted Product", "منتج محذوف")}</span>
        )}
      </Table.Td>
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
