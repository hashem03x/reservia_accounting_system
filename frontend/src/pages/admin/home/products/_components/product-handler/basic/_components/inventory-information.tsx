import { useEffect } from "react";
import { useLanguage } from "@/context/LanguageContext";
import { useWarehouses } from "@/context/WarehousesContext";
import useWarehouseHelpers from "@/hooks/useWarehouseHelpers";
import generateRandomNumber from "@/utils/helpers/generateRandomNumber";
import { Button, NumberInput, TextInput } from "@mantine/core";
import { useProduct } from "../../context";
import PrintProductBarcode from "./print-product-barcode";
import { Link } from "react-router-dom";

// A Product carries its own sku/barcode/stock directly now - there is no separate Variant to hold
// this data (see docs/entities/products.md).
export default function InventoryInformation() {
  const { translate } = useLanguage();

  const { data: warehouses } = useWarehouses();
  const { getWarehouseNameById } = useWarehouseHelpers();

  const { sku, setSku, barcode, setBarcode, stock, setStock, readOnly, currentProduct } = useProduct();

  // Reconcile the stock rows against the live warehouse list - a warehouse created after this
  // product was last saved still needs a (zero-quantity) row to enter stock into.
  useEffect(() => {
    setStock((prevStock) =>
      warehouses.map((warehouse) => {
        const existing = prevStock.find((item) => item.warehouse === warehouse._id);
        return { warehouse: warehouse._id, quantity: existing ? existing.quantity : 0 };
      }),
    );
  }, [warehouses]);

  function handleQuantityChange(index: number, value: number | string) {
    const newStock = [...stock];
    newStock[index].quantity = value;
    setStock(newStock);
  }

  return (
    <div className="product-details-box">
      <h3>{translate("Inventory", "المخزون")}</h3>

      <div className="flex flex-col gap-3 md:flex-row">
        <TextInput
          className="flex-1"
          label={translate("SKU", "رمز المنتج")}
          placeholder={translate("Optional", "اختياري")}
          value={sku}
          onChange={(e) => setSku(e.target.value)}
          readOnly={readOnly}
        />

        <div className="flex flex-1 items-end gap-2">
          <TextInput
            className="flex-1"
            label={translate("Barcode", "الباركود")}
            placeholder={translate("Optional - auto-generated if left empty", "اختياري - يُنشأ تلقائياً إذا تُرك فارغاً")}
            value={barcode}
            onChange={(e) => {
              const value = e.target.value;
              if (/^\d{0,12}$/.test(value)) setBarcode(value);
            }}
            readOnly={readOnly}
          />
          {!readOnly && (
            <Button variant="light" color="blue" onClick={() => setBarcode(generateRandomNumber(12).toString())}>
              {translate("Generate", "توليد")}
            </Button>
          )}
          {currentProduct && <PrintProductBarcode product={currentProduct} buttonType="Icon" />}
        </div>
      </div>

      {currentProduct && (
        <div className="mt-2 flex flex-col gap-2">
          <h5>{translate("Stock Information", "معلومات المخزون")}</h5>

          <table className="w-full text-sm text-gray-600">
            <thead>
              <tr className="border-b">
                <th className="py-1 text-start">{translate("Warehouse", "المخزن")}</th>
                <th className="py-1 text-start">{translate("Quantity", "الكمية")}</th>
              </tr>
            </thead>
            <tbody>
              {stock.map((stockItem, index) => (
                <tr key={stockItem.warehouse} className={`${index + 1 !== stock.length ? "border-b" : ""}`}>
                  <td className="w-1/2">{getWarehouseNameById(stockItem.warehouse)}</td>
                  <td className="w-1/2">
                    <NumberInput
                      placeholder={translate("Quantity", "الكمية")}
                      variant="unstyled"
                      size="xs"
                      min={0}
                      value={stockItem.quantity}
                      onChange={(value) => handleQuantityChange(index, value)}
                      readOnly={readOnly}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div>
            <Link style={{textDecoration:'underline'}} to={`/admin/home/products/${currentProduct._id}/transactions`}>
              View Transactions
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
