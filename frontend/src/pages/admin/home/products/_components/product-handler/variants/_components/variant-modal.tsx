import { Color, Variant } from "@/types/product";
import { useState, useEffect } from "react";
import { useLanguage } from "@/context/LanguageContext";
import { useWarehouses } from "@/context/WarehousesContext";
import useWarehouseHelpers from "@/hooks/useWarehouseHelpers";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import generateRandomNumber from "@/utils/helpers/generateRandomNumber";
import { colorsArray } from "@/utils/constants/colors";
import { Button, NumberInput, Select, TextInput } from "@mantine/core";
import Modal from "@/components/ui/modal";
import ErrorAlert from "@/components/ui/error-alert";
import { useProduct } from "../../context";

type Stock = { quantity: number | string; warehouse: string };

export default function VariantModal({
  opened,
  close,
  variantToUpdate,
  setVariantToUpdate,
}: {
  opened: boolean;
  close: () => void;
  variantToUpdate: Variant | null;
  setVariantToUpdate: React.Dispatch<React.SetStateAction<Variant | null>>;
}) {
  const { language, translate, translations } = useLanguage();

  const { data: warehouses } = useWarehouses();
  const { getWarehouseNameById } = useWarehouseHelpers();

  const { currentProduct, variants, setVariants } = useProduct();
  const productColors = currentProduct?.colors || [];

  const [variantCode, setVariantCode] = useState<string>("");
  const [color, setColor] = useState<Color>("black");
  const [size, setSize] = useState<string>("");
  const [stock, setStock] = useState<Stock[]>([]);

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  useEffect(() => {
    if (variantToUpdate) {
      setVariantCode(variantToUpdate.variantCode);
      setColor(variantToUpdate.color);
      setSize(variantToUpdate.size);
      setStock(
        warehouses.map((warehouse) => {
          const stockItem = variantToUpdate.stock.find((item) => item.warehouse === warehouse._id);
          return { quantity: stockItem ? stockItem.quantity : 0, warehouse: warehouse._id };
        }),
      );
    } else reset();
  }, [variantToUpdate]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // In case of (creating) or (updating with different color or size), check if the variant already exists.
    if (!variantToUpdate || (variantToUpdate && (color !== variantToUpdate.color || size !== variantToUpdate.size)))
      if (isVariantExists(variants, color, size)) {
        setError(translate("This variant already exists.", "هذا الصنف موجود بالفعل."));
        return;
      }

    if (stock.length === 0) {
      setError(translate("Please provide stock information.", "يرجى توفير معلومات المخزون."));
      return;
    }

    // Validate variant code is exactly 12 digits when creating
    if (!variantToUpdate && variantCode.length !== 12) {
      setError(translate("Variant code must be exactly 12 digits.", "يجب أن يكون كود الصنف 12 رقم بالضبط."));
      return;
    }

    handleRequest(language, setLoading, setError, async () => {
      const res = await privateRequest({
        method: variantToUpdate ? "PUT" : "POST",
        url: `products/${currentProduct?._id}/variants${variantToUpdate ? `/${variantToUpdate._id}` : ""}`,
        data: {
          sku: generateRandomNumber(12), // Backend Issue: sku is required.
          variantCode,
          color,
          size,
          // In case of creating a new variant, set the stock to 0 for all warehouses.
          stock: variantToUpdate ? stock : warehouses.map((warehouse) => ({ quantity: 0, warehouse: warehouse._id })),
        },
        language,
      });

      setVariants((prev) =>
        variantToUpdate
          ? prev.map((variant) => (variant._id === variantToUpdate._id ? res.data[0] : variant))
          : [...prev, res.data[0]],
      ); // Backend Issue: res.data is an array.

      handleClose();
    });
  }

  function handleClose() {
    close();
    setTimeout(() => {
      if (variantToUpdate) setVariantToUpdate(null);
      else reset();
      setError("");
    }, 250);
  }

  function reset() {
    setVariantCode(generateRandomNumber(12).toString());
    setColor(productColors[0].name);
    setSize("");
    setStock(warehouses.map((warehouse) => ({ quantity: 0, warehouse: warehouse._id })));
  }

  const title = translate(
    `${variantToUpdate ? "Update" : "Add"} Variant`,
    `${variantToUpdate ? "تحديث الصنف" : "إضافة صنف"}`,
  );

  const dataChanged = variantToUpdate
    ? color !== variantToUpdate.color ||
      size !== variantToUpdate.size ||
      stock.some(
        (stockItem) =>
          variantToUpdate.stock.find((item) => item.warehouse === stockItem.warehouse)?.quantity !== stockItem.quantity,
      ) // To fit with the current warehouses.
    : false;

  const quantitiesProvided = stock.every((stockItem) => stockItem.quantity !== "");

  const variantCodeValid = variantToUpdate ? true : variantCode.length === 12;

  return (
    <Modal opened={opened} onClose={handleClose} title={title} size="lg">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        {/* Barcode / Variant Code */}
        {variantToUpdate ? (
          <div className="flex items-center gap-1 rounded-lg bg-gray-100 p-2 px-3">
            <p className="text-sm">{translate("Barcode", "الباركود")}:</p>
            <h4 className="text-sm">{variantCode}</h4>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              <NumberInput
                flex={1}
                label={translate("Variant Code (12 digits)", "كود الصنف (12 رقم)")}
                placeholder={translate("Enter 12 digits only", "أدخل 12 رقم فقط")}
                value={variantCode}
                onChange={(value) => {
                  const stringValue = String(value);
                  // Only allow numeric input and max 12 digits
                  if (/^\d{0,12}$/.test(stringValue)) {
                    setVariantCode(stringValue);
                  }
                }}
                min={0}
                maxLength={12}
                required
              />
              <Button
                variant="light"
                color="blue"
                onClick={() => setVariantCode(generateRandomNumber(12).toString())}
                style={{ alignSelf: "flex-end" }}
              >
                {translate("Generate", "توليد")}
              </Button>
            </div>
          </div>
        )}

        {/* Color & Size */}
        <div className="flex flex-col gap-2 md:flex-row md:items-end">
          <Select
            label={translate("Select Color", "اختر لون")}
            placeholder={translate("Select Color", "اختر لون")}
            description={translate(
              "Select one of the predefined colors for this product.",
              "اختر أحد الألوان المحددة مسبقاً لهذا المنتج.",
            )}
            value={color}
            onChange={(value) => setColor(value as Color)}
            // Options are filtered based on the colors of the product.
            data={colorsArray
              .filter((color) => productColors.map((productColor) => productColor.name).includes(color.value))
              .map((color) => ({ label: translate(color.label.en, color.label.ar), value: color.value }))}
            allowDeselect={false}
            required
            flex={1}
          />

          <TextInput
            flex={1}
            label={translate("Size", "المقاس")}
            placeholder={translate("Size", "المقاس")}
            value={size}
            onChange={(e) => setSize(e.target.value.toUpperCase())}
            required
          />
        </div>

        {/* Stock Information */}
        {variantToUpdate && (
          <div className="flex flex-col gap-2">
            <div className="flex flex-col rounded-lg bg-gray-100 p-2.5 px-3">
              <h5>{translate("Stock Information", "معلومات المخزون")}</h5>
              <p className="text-xs">
                {translate(
                  "Only Admins are allowed to update the quantities of variants.",
                  "يمكن للمسؤولين فقط تحديث كميات الأصناف.",
                )}
              </p>
            </div>

            <table className="w-full text-sm text-gray-600">
              <thead>
                <tr className="border-b">
                  <th className="py-1 text-start">{translate("Warehouse", "المخزن")}</th>
                  <th className="py-1 text-start">
                    {translate("Quantity", "الكمية")} <span className="text-red-500">*</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {stock.map((stockItem, index) => (
                  <tr key={index} className={`${index + 1 !== stock.length ? "border-b" : ""}`}>
                    <td className="w-1/2">{getWarehouseNameById(stockItem.warehouse)}</td>
                    <td className="w-1/2">
                      <NumberInput
                        placeholder={translate("Enter Quantity (Required)", "أدخل الكمية (مطلوب)")}
                        variant="unstyled"
                        size="xs"
                        min={0}
                        value={stockItem.quantity}
                        onChange={(value) => {
                          const newStock = [...stock];
                          newStock[index].quantity = value;
                          setStock(newStock);
                        }}
                        required
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex gap-2">
          <Button onClick={handleClose} variant="light" color="dark" fullWidth>
            {translations.cancel}
          </Button>
          <Button
            type="submit"
            loading={loading}
            disabled={
              !color || !size || !quantitiesProvided || !variantCodeValid || (variantToUpdate ? !dataChanged : false)
            }
            fullWidth
          >
            {title}
          </Button>
        </div>

        {error && <ErrorAlert error={error} />}
      </form>
    </Modal>
  );
}

// =============================================================

function isVariantExists(existingVariants: Variant[], color: Color, size: string) {
  return existingVariants.some((variant) => variant.color === color && variant.size === size && !variant.isDeleted);
}
