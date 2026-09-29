import { useRef, useState } from "react";
import { useUser } from "@/context/UserContext";
import { useLanguage } from "@/context/LanguageContext";
import { useWarehouses } from "@/context/WarehousesContext";
import useWarehouseHelpers from "@/hooks/useWarehouseHelpers";
import { Variant } from "@/types/product";
import { getColorLabel } from "@/utils/constants/colors";
import { isAdmin } from "@/utils/constants/roles";
import copyToClipboard from "@/utils/helpers/copy-to-clipboard";
import { Button, Menu, Table } from "@mantine/core";
import { useProduct } from "../../context";
import PrintVariantBarcode from "./print-variant-barcode";
import { Link } from "react-router-dom";
import paths from "@/utils/constants/paths";
import { outlineIcons, solidIcons } from "@/components/icons";

export default function VariantCard({
  variant,
  openUpdateModal,
  openDeleteModal,
}: {
  variant: Variant;
  openUpdateModal: () => void;
  openDeleteModal: () => void;
}) {
  const { translate, translations, language } = useLanguage();
  const { user: loggedInUser } = useUser();

  const { data: warehouses } = useWarehouses();
  const { getWarehouseNameById } = useWarehouseHelpers();

  const stock = warehouses.map((warehouse) => {
    const stockItem = variant.stock.find((item) => item.warehouse === warehouse._id);
    return { quantity: stockItem ? stockItem.quantity : 0, warehouse: warehouse._id };
  });

  const [copied, setCopied] = useState(false);

  const { currentProduct } = useProduct();

  if (!currentProduct) return null;

  const handleCopy = () => {
    if (!copied) copyToClipboard(variant.variantCode, setCopied);
  };

  const menu = (
    <Menu withArrow width={215} radius={7.5} shadow="md">
      <Menu.Target>
        <Button variant="light" color="dark" p="xs" radius="lg">
          <solidIcons.TbMenu size={14} />
        </Button>
      </Menu.Target>

      <Menu.Dropdown dir={translations.dir}>
        <PrintVariantBarcode product={currentProduct} variant={variant} buttonType="Menu" />
        <Menu.Item leftSection={<outlineIcons.Copy size={16} />} onClick={handleCopy}>
          {translate("Copy Barcode", "نسخ الباركود")}
        </Menu.Item>
        <Menu.Item leftSection={<outlineIcons.Edit size={16} />} onClick={openUpdateModal}>
          {translate("Edit Variant", "تعديل الصنف")}
        </Menu.Item>
        {/* Temporary hide the delete variant option */}
        {false && (
          <>
            <Menu.Divider />
            <Menu.Label>{translate("Danger Zone", "منطقة الخطر")}</Menu.Label>
            <Menu.Item color="red" leftSection={<outlineIcons.Trash size={16} />} onClick={openDeleteModal}>
              {translate("Delete Variant", "حذف الصنف")}
            </Menu.Item>
          </>
        )}
      </Menu.Dropdown>
    </Menu>
  );

  // check if the color is not found in the product predefined colors
  const colorNotFound = !currentProduct?.colors.find((color) => color.name === variant.color);

  const AmIAdmin = loggedInUser && useRef(isAdmin(loggedInUser.role)).current; // Ref to avoid re-renders

  const renderIfAdmin = (children: React.ReactNode) => {
    if (AmIAdmin) return children;
    return null;
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg bg-white p-4 shadow sm:p-5">
      <div className="flex justify-between">
        <h3>
          <span>{translate(currentProduct.title.en, currentProduct.title.ar)}</span> -{" "}
          <span>{getColorLabel(variant.color, language)}</span> - <span>{variant.size}</span>
        </h3>
        {renderIfAdmin(menu)}
      </div>

      <div className="flex flex-col gap-1.5 text-gray-600">
        <div className="flex items-center gap-1">
          <div className="flex items-center gap-1 text-sm">
            <strong>{translate("Barcode", "الباركود")}:</strong> {variant.variantCode}
            <Button
              onClick={handleCopy}
              title={translate("Copy Barcode", "نسخ الباركود")}
              variant="transparent"
              size="xs"
              px={3}
            >
              {copied ? <solidIcons.Check size={15} /> : <outlineIcons.Copy size={15} />}
            </Button>
          </div>
          <PrintVariantBarcode product={currentProduct} variant={variant} buttonType="Icon" />
        </div>
        <div className="flex items-center gap-1 text-sm">
          <strong>{translate("Color", "اللون")}:</strong> {getColorLabel(variant.color, language)}
          {colorNotFound && <span className="text-xs text-red-600"> ({translate("Not found", "غير موجود")})</span>}
          <span
            className="mx-[3px] h-5 w-5 rounded-full border"
            style={{ backgroundColor: variant.color }}
            title={getColorLabel(variant.color, language)}
          ></span>
        </div>
        <div className="text-sm">
          <strong>{translate("Size", "المقاس")}:</strong> {variant.size}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Link
          // to={`/${paths.admin}/${paths.home}/${paths.variantTransactions}/${variant.variantCode}`}
          to={`/${paths.admin}/${paths.home}/${paths.products}/${paths.variants}/${variant.variantCode}`}
          className="text-sm text-blue-600 hover:underline"
        >
          {translate("View Transactions", "عرض المعاملات")}
        </Link>
      </div>

      <div className="overflow-x-auto">
        <Table className="text-nowrap border-b-0 text-sm" withColumnBorders verticalSpacing={6.5}>
          <Table.Thead className="text-gray-800">
            <Table.Tr>
              <Table.Th>{translate("Warehouse", "المخزن")}</Table.Th>
              <Table.Th>{translate("Quantity", "الكمية")}</Table.Th>
              {renderIfAdmin(
                <>
                  <Table.Th>{translate("Cost", "التكلفة")}</Table.Th>
                  <Table.Th>{translate("Total", "الإجمالي")}</Table.Th>
                </>,
              )}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody className="text-gray-600">
            {stock.map((stockItem) => (
              <Table.Tr key={stockItem.warehouse}>
                <Table.Td>{getWarehouseNameById(stockItem.warehouse)}</Table.Td>
                <Table.Td>
                  {stockItem.quantity} {translate("In Stock", "في المخزون")}
                </Table.Td>
                {renderIfAdmin(
                  <>
                    <Table.Td>
                      {currentProduct.cost || 0} {translations.currency}
                    </Table.Td>
                    <Table.Td>
                      {stockItem.quantity * (currentProduct.cost || 0)} {translations.currency}
                    </Table.Td>
                  </>,
                )}
              </Table.Tr>
            ))}

            <Table.Tr className="font-bold text-gray-800">
              <Table.Td></Table.Td>
              <Table.Td title={translate("Total Quantity", "إجمالي الكمية")}>
                {stock.reduce((acc, item) => acc + item.quantity, 0)} {translate("In Stock", "في المخزون")}
              </Table.Td>
              <Table.Td></Table.Td>
              <Table.Td></Table.Td>
            </Table.Tr>
          </Table.Tbody>
        </Table>
      </div>
    </div>
  );
}
