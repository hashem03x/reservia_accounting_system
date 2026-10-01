import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import { useWarehouses } from "@/context/WarehousesContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { Customer } from "@/types/customer";
import paths from "@/utils/constants/paths";
import { Button, NumberInput } from "@mantine/core";
import ErrorAlert from "@/components/ui/error-alert";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import { OrderItemInput } from "./types";
import validation from "./_utils/validation";
import noProductDetails from "./_utils/no-variant-details";
import CustomerWarehouseSection from "./_components/customer-warehouse-section";
import OrderItemsSection from "./_components/order-items-section";
import InfoItem from "@/components/ui/info-item";

const emptyOrderItem: OrderItemInput = {
  productCode: "",
  productError: false,
  ...noProductDetails,
};

export default function NewSalesOrder() {
  const { language, translate, translations } = useLanguage();

  const title = translate("New Sales Order", "طلب مبيعات جديد");

  useDocumentTitle(`${title} | ${translations.adminPanel}`);

  const navigate = useNavigate();

  const { data: warehouses } = useWarehouses();
  const defatulWarehouseId = warehouses.find((warehouse) => warehouse.isDefault)?._id || warehouses[0]?._id || "";

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [warehouseId, setWarehouseId] = useState<string>(defatulWarehouseId);
  const [items, setItems] = useState<OrderItemInput[]>([emptyOrderItem]);
  const [shippingCost, setShippingCost] = useState<string | number>("");

  const totalAmount = items.reduce((acc, item) => acc + item.starterSubtotal, 0);

  const addNewItem = () => setItems((prevItems) => [...prevItems, emptyOrderItem]);

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  async function handleSaveOrder(e: React.FormEvent) {
    e.preventDefault();
    handleRequest(language, setLoading, setError, async () => {
      const filteredItems = items.filter((item) => item.productData);

      const validationError = validation({ customer, warehouse: warehouseId, items: filteredItems }, language);

      if (validationError) {
        setError(validationError);
        return;
      }

      const response = await privateRequest({
        language,
        method: "POST",
        url: `sale-orders`,
        data: {
          isPrepaid: false,
          warehouse: warehouseId,
          customer: customer?._id,
          items: filteredItems.map((item) => ({
            product: item.productData?._id,
            unitPrice: item.unitPrice,
            itemDiscount: item.itemDiscount,
            starterQuantity: item.starterQuantity,
          })),
          shippingCost: shippingCost ? Number(shippingCost) : undefined,
        },
      });

      navigate(`/${paths.admin}/${paths.home}/${paths.salesOrders}/${response.data._id}`);
    });
  }

  return (
    <AdminLayoutBox
      header={{
        title,
        backLink: true,
        border: true,
        sideElements: (
          <Button onClick={handleSaveOrder} size="md" px="xl" radius="md" loading={loading}>
            {translate("Save", "حفظ")}
          </Button>
        ),
      }}
    >
      {error && (
        <>
          <ErrorAlert error={error} />
          <hr />
        </>
      )}

      {/* Total Amount */}
      <div className="flex flex-col gap-2">
        <InfoItem
          label={translate("Order Amount", "سعر الطلب")}
          value={`${totalAmount.toFixed(2)} ${translations.currency}`}
        />
        {+shippingCost > 0 && (
          <InfoItem
            label={translate("Total Amount", "المبلغ الإجمالي")}
            value={`${(totalAmount + +shippingCost).toFixed(2)} ${translations.currency}`}
          />
        )}
      </div>

      <hr />

      <CustomerWarehouseSection
        customer={customer}
        setCustomer={setCustomer}
        warehouseId={warehouseId}
        setWarehouseId={setWarehouseId}
      />

      <hr />

      <OrderItemsSection items={items} setItems={setItems} addNewItem={addNewItem} warehouseId={warehouseId} />

      <hr />

      {/* Total Items */}
      <InfoItem
        label={translate("Total Items", "إجمالي القطع")}
        value={items.reduce((acc, item) => acc + (item.starterQuantity || 0), 0).toString()}
      />

      <hr />

      {/* Shipping Cost (Optional) */}
      <NumberInput
        label={translate("Shipping Cost (Optional)", "تكلفة الشحن (اختياري)")}
        placeholder={translate("Enter Shipping Cost", "ادخل تكلفة الشحن")}
        value={shippingCost}
        onChange={setShippingCost}
        min={0}
        max={10000}
        decimalScale={2}
        hideControls
        style={{ maxWidth: 250 }}
      />
    </AdminLayoutBox>
  );
}
