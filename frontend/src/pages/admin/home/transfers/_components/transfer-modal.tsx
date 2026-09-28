import { useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import { useWarehouses } from "@/context/WarehousesContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { Transfer, TransferType } from "@/types/transfer";
import { Product } from "@/types/product";
import { PaginatedData } from "@/types/global";
import { transferTypesArray } from "@/utils/constants/transfer-types";
import { getColorLabel } from "@/utils/constants/colors";
import { Button, NumberInput, Select, Table } from "@mantine/core";
import { outlineIcons } from "@/components/icons";
import ProductSearch from "@/components/global/product-search";
import Modal from "@/components/ui/modal";
import ErrorAlert from "@/components/ui/error-alert";

export default function TransferModal({
  opened,
  close,
  setPaginatedTransfers,
}: {
  opened: boolean;
  close: () => void;
  setPaginatedTransfers: React.Dispatch<React.SetStateAction<PaginatedData<Transfer>>>;
}) {
  const { language, translate, translations } = useLanguage();

  const [warehouseId, setWarehouseId] = useState("");
  const [targetWarehouseId, setTargetWarehouseId] = useState("");
  const [type, setType] = useState<TransferType>("product");
  const [product, setProduct] = useState<Product | null>(null);
  const [variants, setVariants] = useState<{ variantId: string; quantity: number }[]>([]);

  const { data: warehouses } = useWarehouses();
  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  // Update the quantity for a specific variant
  function updateVariantQuantity(variantId: string, quantity: number) {
    setVariants((prev) =>
      prev.some((v) => v.variantId === variantId)
        ? prev.map((v) => (v.variantId === variantId ? { ...v, quantity } : v))
        : [...prev, { variantId, quantity }],
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    handleRequest(language, setLoading, setError, async () => {
      // Backend Issue: The body schema is not organized.
      const res = await privateRequest({
        language,
        method: "POST",
        url: "transfer",
        data: {
          type,
          warehouseId,
          targetWarehouseId,
          productId: type === "variants" ? product?._id : undefined,
          details: type === "variants" ? variants.filter((variant) => variant.quantity > 0) : { productId: product?._id },
        },
      });

      setPaginatedTransfers((prev) => {
        if (!prev) return null;
        return { ...prev, data: [res.data[0], ...prev.data] }; // Backend Issue: The response is an array.
      });

      handleClose();
    });
  }

  function handleClose() {
    close();
    setTimeout(() => {
      reset();
      setError("");
    }, 250);
  }

  function reset() {
    setWarehouseId("");
    setTargetWarehouseId("");
    setType("product");
    setProduct(null);
    setVariants([]);
  }

  const title = translate("Add Transfer", "إضافة تحويلة");

  return (
    <Modal opened={opened} onClose={handleClose} title={title} size="xl">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {/* Warehouses */}
        <div className="flex flex-col gap-2 md:flex-row md:items-end">
          <Select
            label={translate("From Warehouse", "من المخزن")}
            placeholder={translate("Select Warehouse", "اختر المخزن")}
            value={warehouseId}
            onChange={(value) => setWarehouseId(value || "")}
            data={warehouses
              .filter((warehouse) => warehouse._id !== targetWarehouseId)
              .map((warehouse) => ({ value: warehouse._id, label: warehouse.name }))}
            required
            flex={1}
          />
          <Select
            label={translate("To Warehouse", "إلى المخزن")}
            placeholder={translate("Select Warehouse", "اختر المخزن")}
            value={targetWarehouseId}
            onChange={(value) => setTargetWarehouseId(value || "")}
            data={warehouses
              .filter((warehouse) => warehouse._id !== warehouseId)
              .map((warehouse) => ({ value: warehouse._id, label: warehouse.name }))}
            required
            flex={1}
          />
          {/* Swap Warehouses */}
          <Button
            title={translate("Swap Warehouses", "تبديل المخازن")}
            onClick={() => {
              setWarehouseId(targetWarehouseId);
              setTargetWarehouseId(warehouseId);
            }}
            variant="light"
            color="gray"
            px="xs"
          >
            <outlineIcons.Transaction size={20} />
          </Button>
        </div>

        {/* Product */}
        <ProductSearch
          label={translate("Product to transfer", "المنتج المراد تحويله")}
          placeholder={translate("Select Product", "اختر المنتج")}
          product={product}
          setProduct={setProduct}
          required
        />

        {/* Type */}
        <div>
          <h4 className="mb-2 text-sm">
            {translate("Transfer Type", "نوع التحويل")} <span className="text-red-600">*</span>
          </h4>
          <div className="flex flex-row-reverse overflow-hidden rounded">
            {transferTypesArray.map((transferType) => (
              <Button
                key={transferType.value}
                onClick={() => setType(transferType.value)}
                variant={transferType.value === type ? "filled" : "light"}
                color={transferType.value === type ? "teal" : "gray"}
                fullWidth
                radius={0}
              >
                {translate(transferType.label.en, transferType.label.ar)}
              </Button>
            ))}
          </div>
        </div>

        {/* Variants */}
        {warehouseId && product && type === "variants" && (
          <div>
            <h4 className="mb-2 text-sm">
              {translate("Variants", "الأصناف")} <span className="text-red-600">*</span>
            </h4>

            {product.variants.length === 0 ? (
              <div className="rounded-lg bg-gray-100 p-4 text-center text-gray-800">
                {translate(
                  "No variants found for this product, please select another product",
                  "لا توجد أصناف لهذا المنتج، يرجى اختيار منتج آخر",
                )}
              </div>
            ) : (
              // Table for variants
              <div className="overflow-x-auto">
                <Table className="w-full text-nowrap text-sm text-gray-600" verticalSpacing={7.5}>
                  <Table.Thead>
                    <Table.Tr className="border-b">
                      <Table.Th className="py-1 text-start">{translate("Title", "العنوان")}</Table.Th>
                      <Table.Th className="py-1 text-start">{translate("Code", "الكود")}</Table.Th>
                      <Table.Th className="py-1 text-start">{translate("Color", "اللون")}</Table.Th>
                      <Table.Th className="py-1 text-start">{translate("Size", "المقاس")}</Table.Th>
                      <Table.Th className="py-1 text-start">{translate("Available", "المتوفر")}</Table.Th>
                      <Table.Th className="py-1 text-start">
                        {translate("Required Quantity", "الكمية المطلوبة")} <span className="text-red-600">*</span>
                      </Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {product.variants
                      .filter((variant) => !variant.isDeleted)
                      .map((variant) => (
                        <Table.Tr key={variant._id}>
                          <Table.Td>{translate(product.title.en, product.title.ar)}</Table.Td>
                          <Table.Td className="text-gray-800">{variant.variantCode}</Table.Td>
                          <Table.Td className="text-gray-800">{getColorLabel(variant.color, language)}</Table.Td>
                          <Table.Td className="text-gray-800">{variant.size}</Table.Td>
                          <Table.Td className="text-gray-800">
                            {variant.stock.find((stock) => stock.warehouse === warehouseId)?.quantity || 0}
                          </Table.Td>
                          <Table.Td py={0}>
                            <NumberInput
                              placeholder={translate("Enter Quantity (Required)", "أدخل الكمية (مطلوب)")}
                              className="font-bold"
                              variant="unstyled"
                              size="xs"
                              min={0}
                              value={variants.find((v) => v.variantId === variant._id)?.quantity || 0}
                              onChange={(quantity) => updateVariantQuantity(variant._id, (quantity as number) || 0)}
                              required
                            />
                          </Table.Td>
                        </Table.Tr>
                      ))}
                  </Table.Tbody>
                </Table>
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <Button onClick={handleClose} variant="light" color="dark" fullWidth>
            {translations.cancel}
          </Button>
          <Button
            type="submit"
            loading={loading}
            disabled={!warehouseId || !targetWarehouseId || !product || (type === "variants" && !variants.length)}
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
