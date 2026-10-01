import { useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import { useWarehouses } from "@/context/WarehousesContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { Transfer, TransferType } from "@/types/transfer";
import { Product } from "@/types/product";
import { PaginatedData } from "@/types/global";
import { transferTypesArray } from "@/utils/constants/transfer-types";
import { Button, NumberInput, Select, Table } from "@mantine/core";
import { outlineIcons, solidIcons } from "@/components/icons";
import ProductSearch from "@/components/global/product-search";
import Modal from "@/components/ui/modal";
import ErrorAlert from "@/components/ui/error-alert";

type ProductRow = { product: Product | null; quantity: number };

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
  // For type "product" - move all available stock of this one product.
  const [product, setProduct] = useState<Product | null>(null);
  // For type "products" - move a specific quantity of each listed product.
  const [productRows, setProductRows] = useState<ProductRow[]>([{ product: null, quantity: 0 }]);

  const { data: warehouses } = useWarehouses();
  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  function addProductRow() {
    setProductRows((prev) => [...prev, { product: null, quantity: 0 }]);
  }

  function removeProductRow(index: number) {
    setProductRows((prev) => prev.filter((_, i) => i !== index));
  }

  function updateProductRow(index: number, updates: Partial<ProductRow>) {
    setProductRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...updates } : row)));
  }

  const validProductRows = productRows.filter((row) => row.product && row.quantity > 0);

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
          productId: type === "products" ? validProductRows[0]?.product?._id : undefined,
          details:
            type === "products"
              ? validProductRows.map((row) => ({ productId: row.product?._id, quantity: row.quantity }))
              : { productId: product?._id },
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
    setProductRows([{ product: null, quantity: 0 }]);
  }

  const title = translate("Add Transfer", "إضافة تحويلة");

  const canSubmit =
    !!warehouseId && !!targetWarehouseId && (type === "product" ? !!product : validProductRows.length > 0);

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

        {/* Entire Product */}
        {type === "product" && (
          <ProductSearch
            label={translate("Product to transfer", "المنتج المراد تحويله")}
            placeholder={translate("Select Product", "اختر المنتج")}
            product={product}
            setProduct={setProduct}
            required
          />
        )}

        {/* Specific Products */}
        {type === "products" && (
          <div>
            <h4 className="mb-2 text-sm">
              {translate("Products", "المنتجات")} <span className="text-red-600">*</span>
            </h4>

            <div className="overflow-x-auto">
              <Table className="w-full text-nowrap text-sm text-gray-600" verticalSpacing={7.5}>
                <Table.Thead>
                  <Table.Tr className="border-b">
                    <Table.Th className="py-1 text-start">{translate("Product", "المنتج")}</Table.Th>
                    <Table.Th className="py-1 text-start">{translate("Available", "المتوفر")}</Table.Th>
                    <Table.Th className="py-1 text-start">
                      {translate("Required Quantity", "الكمية المطلوبة")} <span className="text-red-600">*</span>
                    </Table.Th>
                    <Table.Th className="py-1 text-start"></Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {productRows.map((row, index) => {
                    const availableQuantity =
                      (warehouseId && row.product?.stock?.find((stock) => stock.warehouse === warehouseId)?.quantity) ||
                      0;

                    return (
                      <Table.Tr key={index}>
                        <Table.Td>
                          <ProductSearch
                            placeholder={translate("Select Product", "اختر المنتج")}
                            product={row.product}
                            setProduct={(value) =>
                              updateProductRow(index, { product: typeof value === "function" ? value(row.product) : value })
                            }
                          />
                        </Table.Td>
                        <Table.Td className="text-gray-800">{row.product ? availableQuantity : "-"}</Table.Td>
                        <Table.Td py={0}>
                          <NumberInput
                            placeholder={translate("Enter Quantity (Required)", "أدخل الكمية (مطلوب)")}
                            className="font-bold"
                            variant="unstyled"
                            size="xs"
                            min={0}
                            value={row.quantity}
                            onChange={(quantity) => updateProductRow(index, { quantity: (quantity as number) || 0 })}
                            disabled={!row.product}
                          />
                        </Table.Td>
                        <Table.Td py={0}>
                          {productRows.length > 1 && (
                            <button type="button" className="text-red-500" onClick={() => removeProductRow(index)}>
                              <outlineIcons.Trash size={16.5} />
                            </button>
                          )}
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </div>

            <Button onClick={addProductRow} variant="light" size="xs" mt="xs" leftSection={<solidIcons.Plus size={14} />}>
              {translate("Add Product", "إضافة منتج")}
            </Button>
          </div>
        )}

        <div className="flex gap-2">
          <Button onClick={handleClose} variant="light" color="dark" fullWidth>
            {translations.cancel}
          </Button>
          <Button type="submit" loading={loading} disabled={!canSubmit} fullWidth>
            {title}
          </Button>
        </div>

        {error && <ErrorAlert error={error} />}
      </form>
    </Modal>
  );
}
