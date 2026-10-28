import { useRef } from "react";
import { useDisclosure } from "@mantine/hooks";
import { useLanguage } from "@/context/LanguageContext";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import { ItemDiscount } from "@/types/orders";
import { DEFAULT_VARIANT_CODE_LENGTH } from "@/utils/constants";
import { outlineIcons, solidIcons } from "@/components/icons";
import { Button, NumberInput, Table, TextInput } from "@mantine/core";
import ProductSearchModal from "@/components/global/variant-search-modal";
import { OrderItemInput, PurchaseOrderLines } from "../../../types";
import { MAX_ITEM_QUANTITY } from "../../../_utils/validation";
import { calculateSubTotal, calculateUnitPriceAfterDiscount } from "../../../_utils/calculations";
import noProductDetails from "../../../_utils/no-variant-details";
import { getPurchaseUnitPrice } from "@/utils/helpers/purchase-unit-price";

const innerTableCells = 6; // Number of cells between the barcode cell and the deleteItem cell

export default function OrderItemRow({
  index,
  items,
  setItems,
  poLines,
  // addNewItem,
}: {
  index: number;
  items: OrderItemInput[];
  setItems: React.Dispatch<React.SetStateAction<OrderItemInput[]>>;
  addNewItem?: () => void;
  poLines?: PurchaseOrderLines | null;
}) {
  const { translate, language, translations } = useLanguage();
  const privateRequest = usePrivateRequest();
  const abortControllerRef = useRef<AbortController | null>(null);

  const currentItem = items[index];
  const {
    productCode,
    productError,
    productErrorMessage,
    productData,
    unitPrice,
    itemDiscount,
    unitPriceAfterDiscount,
    starterQuantity,
    starterSubtotal,
  } = currentItem;

  // This item's Purchase Order line: its agreed price and what is left to invoice (less what the
  // invoice's other rows of the same product already take).
  const poLine = productData ? poLines?.lines.find((line) => line.product === productData._id) : undefined;
  const otherRowsQuantity = items.reduce((sum, item, i) => (i !== index && productData && item.productData?._id === productData._id ? sum + (Number(item.starterQuantity) || 0) : sum), 0);
  const maxQuantity = poLine ? Math.max(0, Math.min(MAX_ITEM_QUANTITY, poLine.remaining - otherRowsQuantity)) : MAX_ITEM_QUANTITY;

  const updateItem = (updates: Partial<typeof currentItem>) => {
    setItems((prevItems) => {
      const updatedItems = [...prevItems];
      updatedItems[index] = { ...currentItem, ...updates };
      return updatedItems;
    });
  };

  const handleProductCodeChange = (newProductCode: string) => {
    updateItem({ productCode: newProductCode });

    // Cancel the previous request if it exists
    if (abortControllerRef.current) abortControllerRef.current.abort();

    // Check if the barcode length is between 6 and 20 digits
    if (newProductCode.length >= 6 && newProductCode.length <= 20) {
      // Check if the product code already exists in the items list
      const existingItemIndex = items.findIndex((item) => item.productCode === newProductCode);

      // If the product code already exists, just increase the quantity of the existing item
      if (existingItemIndex !== -1) {
        setItems((prevItems) => {
          const updatedItems = [...prevItems];
          const existingItem = updatedItems[existingItemIndex];
          const updatedQuantity = existingItem.starterQuantity + 1;
          const updatedSubtotal = calculateSubTotal(existingItem.unitPriceAfterDiscount, updatedQuantity);

          updatedItems[existingItemIndex] = {
            ...existingItem,
            starterQuantity: updatedQuantity,
            starterSubtotal: updatedSubtotal,
          };

          // Clear the new input row
          updatedItems[index] = { productCode: "", productError: false, ...noProductDetails };
          return updatedItems;
        });
      } else {
        // Only add a new item if this is the last item
        // if (index === items.length - 1) addNewItem();

        // Create a new AbortController for the new request
        const abortController = new AbortController();
        abortControllerRef.current = abortController;

        (async () => {
          try {
            const response = await privateRequest({
              url: `products/code/${newProductCode}`,
              signal: abortController.signal,
              language,
            });
            // With a Purchase Order, an item must be on it (unless it has legacy description-only
            // lines) with something left to invoice, and it starts at the PO line's agreed price.
            const line = poLines?.lines.find((l) => l.product === response.data._id);
            const refusal =
              poLines && !line && !poLines.hasUnmatchableLines
                ? translate("This item is not on the selected Purchase Order.", "هذا الصنف غير موجود في أمر الشراء المحدد.")
                : line && line.remaining <= 0
                  ? translate("Nothing is left to invoice for this item on the selected Purchase Order.", "لا توجد كمية متبقية لهذا الصنف في أمر الشراء المحدد.")
                  : "";
            if (refusal) {
              updateItem({ productCode: newProductCode, productError: true, productErrorMessage: refusal, ...noProductDetails });
              return;
            }
            // Without a PO line: a product is bought at its cost; a service has no cost field, so
            // it starts at its price. No catalog cost/price (optional): the line starts empty.
            const unitPrice = line ? line.unitPrice : (getPurchaseUnitPrice(response.data) ?? undefined);
            updateItem({
              productCode: newProductCode,
              productError: false,
              productData: response.data,
              starterQuantity: 1,
              unitPrice,
              itemDiscount: { type: "percentage", value: 0 },
              // Totals start at 0 (never NaN) until the purchase price is entered.
              unitPriceAfterDiscount: unitPrice ?? 0,
              starterSubtotal: unitPrice ?? 0,
            });
          } catch (error) {
            updateItem({
              productCode: newProductCode,
              productError: true,
              productErrorMessage: (error as { message?: string })?.message,
              ...noProductDetails,
            });
          }
        })();
      }
    } else if (newProductCode.length < DEFAULT_VARIANT_CODE_LENGTH) {
      updateItem({ productCode: newProductCode, productError: false, ...noProductDetails });
    }
  };

  const handleValueChange = (
    field: "starterQuantity" | "unitPrice" | "itemDiscount",
    value: number | string | ItemDiscount,
  ) => {
    const updatedItem = { ...currentItem, [field]: value };
    const updatedUnitPriceAfterDiscount = calculateUnitPriceAfterDiscount(updatedItem.unitPrice, updatedItem.itemDiscount);
    const updatedSubTotal = calculateSubTotal(updatedUnitPriceAfterDiscount, updatedItem.starterQuantity);

    updateItem({
      [field]: value,
      unitPriceAfterDiscount: updatedUnitPriceAfterDiscount,
      starterSubtotal: updatedSubTotal,
    });
  };

  const handleDeleteItem = () => {
    setItems((prevItems) => {
      const updatedItems = [...prevItems];
      updatedItems.splice(index, 1);
      return updatedItems;
    });
  };

  const [searchModalOpened, { open: openSearchModal, close: closeSearchModal }] = useDisclosure();

  return (
    <Table.Tr className="text-gray-600">
      <Table.Td className="flex items-center gap-2">
        <TextInput
          variant="unstyled"
          placeholder={translate("Barcode", "الباركود")}
          value={productCode}
          onChange={(e) => handleProductCodeChange(e.target.value)}
          maxLength={DEFAULT_VARIANT_CODE_LENGTH}
          className="font-medium text-gray-800"
          autoFocus
        />

        {!productData && (
          <Button onClick={openSearchModal} variant="transparent" size="xs" px={5}>
            <solidIcons.Search size={20} />
          </Button>
        )}

        <ProductSearchModal
          opened={searchModalOpened}
          close={closeSearchModal}
          mode="purchase"
          onSelect={(selectedProductCode) => handleProductCodeChange(selectedProductCode)}
        />
      </Table.Td>

      {productError ? (
        <Table.Td colSpan={innerTableCells} className="animate-fade-in bg-red-100">
          <div className="flex items-center gap-2">
            <solidIcons.ExclamationCircle className="text-red-500" size={15} />
            <p className="text-xs md:text-sm">
              {productErrorMessage || translate("This product does not exist.", "هذا المنتج غير موجود.")}
            </p>
          </div>
        </Table.Td>
      ) : productData ? (
        <>
          <Table.Td>{translate(productData.title.en, productData.title.ar)}</Table.Td>
          <Table.Td>
            <NumberInput
              variant="unstyled"
              placeholder={translate("Quantity", "الكمية")}
              value={starterQuantity}
              onChange={(value) => handleValueChange("starterQuantity", value)}
              min={1}
              max={maxQuantity}
              clampBehavior="strict"
              allowNegative={false}
              decimalScale={0}
              className="font-bold text-gray-800"
              hideControls
              required
            />
            {poLine && (
              <p className="text-[11px] text-gray-500">
                {translate(`${poLine.remaining} of ${poLine.ordered} left on the PO`, `متبقي ${poLine.remaining} من ${poLine.ordered} في أمر الشراء`)}
              </p>
            )}
          </Table.Td>
          <Table.Td>
            <NumberInput
              variant="unstyled"
              placeholder={translate("Unit Price", "سعر الوحدة")}
              value={unitPrice}
              onChange={(value) => handleValueChange("unitPrice", value)}
              min={0}
              decimalScale={2}
              className="font-medium text-gray-800"
              hideControls
              required
            />
          </Table.Td>
          <Table.Td>
            <div className="flex items-center justify-between gap-1">
              <NumberInput
                variant="unstyled"
                placeholder={translate("Discount", "الخصم")}
                value={itemDiscount.value}
                onChange={(value) => handleValueChange("itemDiscount", { value: value as number, type: itemDiscount.type })}
                min={0}
                max={itemDiscount.type === "percentage" ? 100 : unitPrice}
                decimalScale={2}
                clampBehavior="strict"
                className="font-medium text-gray-800"
                hideControls
                flex={1}
              />
              <button
                type="button"
                title={translate("Change Discount Type", "تغيير نوع الخصم")}
                className="flex-center rounded-md bg-gray-200 px-3 hover:bg-gray-300"
                onClick={() =>
                  handleValueChange("itemDiscount", {
                    value: 0,
                    type: itemDiscount.type === "percentage" ? "fixed" : "percentage",
                  })
                }
              >
                {itemDiscount.type === "percentage" ? translate("Percent", "نسبة") : translate("Fixed", "ثابت")}
              </button>
            </div>
          </Table.Td>
          <Table.Td>
            {unitPriceAfterDiscount.toFixed(2)} {translations.currency}
          </Table.Td>
          <Table.Td className="font-bold text-gray-800">
            {starterSubtotal.toFixed(2)} {translations.currency}
          </Table.Td>
        </>
      ) : (
        Array.from({ length: innerTableCells }).map((_, i) => <Table.Td key={i} />)
      )}

      {items.length > 1 && (
        <Table.Td color="red">
          <button
            type="button"
            title={translate("Remove Item", "حذف العنصر")}
            className="flex-center w-full text-red-500"
            onClick={handleDeleteItem}
          >
            <outlineIcons.Trash size={16.5} />
          </button>
        </Table.Td>
      )}
    </Table.Tr>
  );
}
