import { useEffect, useRef } from "react";
import { useDisclosure } from "@mantine/hooks";
import { useLanguage } from "@/context/LanguageContext";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import { ItemDiscount } from "@/types/orders";
import { getColorLabel } from "@/utils/constants/colors";
import { outlineIcons, solidIcons } from "@/components/icons";
import { Button, NumberInput, Table, TextInput, Tooltip } from "@mantine/core";
import VariantSearchModal from "@/components/global/variant-search-modal";
import { OrderItemInput } from "../../../types";
import { calculateSubTotal, calculateUnitPriceAfterDiscount } from "../../../_utils/calculations";
import noVariantDetails from "../../../_utils/no-variant-details";

const innerTableCells = 8; // Number of cells between variantCode cell and the deleteItem cell

export default function OrderItemRow({
  index,
  items,
  setItems,
  addNewItem,
  warehouseId,
}: {
  index: number;
  items: OrderItemInput[];
  setItems: React.Dispatch<React.SetStateAction<OrderItemInput[]>>;
  addNewItem: () => void;
  warehouseId: string;
}) {
  const { translate, language, translations } = useLanguage();
  const privateRequest = usePrivateRequest();
  const abortControllerRef = useRef<AbortController | null>(null);

  const currentItem = items[index];
  const {
    variantCode,
    variantError,
    variantData,
    unitPrice,
    itemDiscount,
    unitPriceAfterDiscount,
    starterQuantity,
    starterSubtotal,
  } = currentItem;

  const updateItem = (updates: Partial<typeof currentItem>) => {
    setItems((prevItems) => {
      const updatedItems = [...prevItems];
      updatedItems[index] = { ...currentItem, ...updates };
      return updatedItems;
    });
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Enter") {
        event.preventDefault(); // Prevent unintended form submission
        if (index === items.length - 1 && !variantError) {
          addNewItem();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [index, items.length, variantError, addNewItem]);

  const handleVariantCodeChange = (newVariantCode: string) => {
    updateItem({ variantCode: newVariantCode });

    // Cancel the previous request if it exists
    if (abortControllerRef.current) abortControllerRef.current.abort();

    // Check if the variant code length is between 6 and 20 digits
    if (newVariantCode.length >= 6 && newVariantCode.length <= 20) {
      // Check if the variant code already exists in the items list
      // const existingItemIndex = items.findIndex((item) => item.variantCode === newVariantCode);
      const existingItemIndex = items.findIndex(
        (item) => item.variantCode === newVariantCode && item.itemDiscount.value === 0,
      );

      // If the variant code already exists, just increase the quantity of the existing item
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
          updatedItems[index] = { variantCode: "", variantError: false, ...noVariantDetails };
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
              url: `variants/${newVariantCode}`,
              signal: abortController.signal,
              language,
            });
            const price = response.data.product.price;
            const priceAfterDiscount = response.data.product.priceAfterDiscount || price;
            updateItem({
              variantCode: newVariantCode,
              variantError: false,
              variantData: response.data,
              starterQuantity: 1,
              unitPrice: price,
              itemDiscount: { type: "fixed", value: price - priceAfterDiscount },
              unitPriceAfterDiscount: priceAfterDiscount,
              starterSubtotal: priceAfterDiscount,
            });
          } catch (error) {
            // If the request is aborted, do nothing
            if ((error as Error).name === "AbortError") return;
            updateItem({ variantCode: newVariantCode, variantError: true, ...noVariantDetails });
          }
        })();
      }
    } else {
      updateItem({ variantCode: newVariantCode, variantError: false, ...noVariantDetails });
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

  const stock = variantData?.stock.find((stock) => stock.warehouse === warehouseId);
  const quantityAvailable = stock?.quantity || 0;
  // Total quantity requested for the same variant across all rows
  const totalRequestedForVariant = items.reduce((sum, item) => {
    if (item.variantCode && item.variantCode === currentItem.variantCode) {
      return sum + (Number(item.starterQuantity) || 0);
    }
    return sum;
  }, 0);
  const exceedsAvailable = totalRequestedForVariant > quantityAvailable;

  return (
    <Table.Tr className="text-gray-600">
      <Table.Td className="flex items-center gap-2">
        <TextInput
          variant="unstyled"
          placeholder={translate("Variant Code", "كود الصنف")}
          value={variantCode}
          onChange={(e) => handleVariantCodeChange(e.target.value)}
          maxLength={20}
          className="font-medium text-gray-800"
          autoFocus
        />

        {!variantData && (
          <Button onClick={openSearchModal} variant="transparent" size="xs" px={5}>
            <solidIcons.Search size={20} />
          </Button>
        )}

        <VariantSearchModal
          opened={searchModalOpened}
          close={closeSearchModal}
          mode="sales"
          onSelect={(selectedVariantCode) => handleVariantCodeChange(selectedVariantCode)}
        />
      </Table.Td>

      {variantError ? (
        <Table.Td colSpan={innerTableCells} className="animate-fade-in bg-red-100">
          <div className="flex items-center gap-2">
            <solidIcons.ExclamationCircle className="text-red-500" size={15} />
            <p className="text-xs md:text-sm">{translate("This variant does not exist.", "هذا الصنف غير موجود.")}</p>
          </div>
        </Table.Td>
      ) : variantData ? (
        <>
          <Table.Td>{translate(variantData.product.title.en, variantData.product.title.ar)}</Table.Td>
          <Table.Td>{getColorLabel(variantData.color, language)}</Table.Td>
          <Table.Td>{variantData?.size}</Table.Td>
          <Table.Td>
            <NumberInput
              variant="unstyled"
              placeholder={translate("Quantity", "الكمية")}
              value={starterQuantity}
              onChange={(value) => handleValueChange("starterQuantity", value)}
              min={1}
              max={1000}
              decimalScale={0}
              className="font-bold text-gray-800"
              // hideControls
              required
              // Alert the user if the quantity is more than the available quantity
              rightSection={
                exceedsAvailable ? (
                  <Tooltip
                    withArrow
                    label={
                      quantityAvailable === 0
                        ? translate("Out of stock", "إنتهى من المخزن")
                        : translate(
                            `Requested ${totalRequestedForVariant}, only ${quantityAvailable} available`,
                            `المطلوب ${totalRequestedForVariant}، المتاح فقط ${quantityAvailable}`,
                          )
                    }
                  >
                    <div className="animate-pulse">
                      <solidIcons.ExclamationCircle size={15} className="text-red-500" />
                    </div>
                  </Tooltip>
                ) : null
              }
            />
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
