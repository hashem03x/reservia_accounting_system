import { isWebsiteOrder } from "@/utils/constants/order-sources";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import HeaderSection from "./_components/header-section";
import CustomerWarehouseSection from "./_components/customer-warehouse-section";
import OrderItemsSection from "./_components/order-items-section";
import WebsiteDetailsSection from "./_components/website-details-section";
import { useOrder } from "../../../context";

export default function Overview() {
  const { order } = useOrder();

  return (
    <AdminLayoutBox>
      <HeaderSection />
      <hr />
      <CustomerWarehouseSection />
      <hr />
      <OrderItemsSection />

      {isWebsiteOrder(order.orderSource) && (
        <>
          <hr />
          <WebsiteDetailsSection />
        </>
      )}
    </AdminLayoutBox>
  );
}
