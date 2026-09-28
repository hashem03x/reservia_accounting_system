import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import { useWarehouses } from "@/context/WarehousesContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { Vendor } from "@/types/vendor";
import paths from "@/utils/constants/paths";
import { Button } from "@mantine/core";
import ErrorAlert from "@/components/ui/error-alert";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import { OrderItemInput } from "./types";
import validation from "./_utils/validation";
import noVariantDetails from "./_utils/no-variant-details";
import VendorWarehouseSection from "./_components/vendor-warehouse-section";
import OrderItemsSection from "./_components/order-items-section";

const emptyOrderItem: OrderItemInput = {
  variantCode: "",
  variantError: false,
  ...noVariantDetails,
};

export default function NewPurchaseOrder() {
  const { language, translate, translations } = useLanguage();

  const title = translate("New Purchase Order", "طلب مشتريات جديد");

  useDocumentTitle(`${title} | ${translations.adminPanel}`);

  const navigate = useNavigate();

  const { data: warehouses } = useWarehouses();
  const defatulWarehouseId = warehouses.find((warehouse) => warehouse.isDefault)?._id || warehouses[0]?._id || "";

  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [warehouseId, setWarehouseId] = useState<string>(defatulWarehouseId);
  const [items, setItems] = useState<OrderItemInput[]>([emptyOrderItem]);

  const totalAmount = items.reduce((acc, item) => acc + item.starterSubtotal, 0);

  const addNewItem = () => setItems((prevItems) => [...prevItems, emptyOrderItem]);

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  async function handleSaveOrder(e: React.FormEvent) {
    e.preventDefault();
    handleRequest(language, setLoading, setError, async () => {
      const filteredItems = items.filter((item) => item.variantData);

      const validationError = validation({ vendor, warehouse: warehouseId, items: filteredItems }, language);

      if (validationError) {
        setError(validationError);
        return;
      }

      const response = await privateRequest({
        language,
        method: "POST",
        url: `purchaseorder`,
        data: {
          warehouseId,
          vendorId: vendor?._id,
          items: filteredItems.map((item) => ({
            variantId: item.variantData?._id,
            unitPrice: item.unitPrice,
            itemDiscount: item.itemDiscount,
            starterQuantity: item.starterQuantity,
          })),
        },
      });

      navigate(`/${paths.admin}/${paths.home}/${paths.purchaseOrders}/${response.data._id}`);
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
      <div className="flex items-center gap-1.5 text-xs md:text-sm">
        <span className="text-gray-600">{translate("Order Total Amount", "اجمالى سعر الطلب")}:</span>
        <span className="font-bold text-gray-800">{`${totalAmount.toFixed(2)} ${translations.currency}`}</span>
      </div>

      <hr />

      <VendorWarehouseSection
        vendor={vendor}
        setVendor={setVendor}
        warehouseId={warehouseId}
        setWarehouseId={setWarehouseId}
      />

      <hr />

      <OrderItemsSection items={items} setItems={setItems} addNewItem={addNewItem} />
    </AdminLayoutBox>
  );
}
