import AdminLayoutBox from "@/components/ui/admin-layout-box";
import HeaderSection from "./_components/header-section";
import VendorWarehouseSection from "./_components/vendor-warehouse-section";
import OrderItemsSection from "./_components/order-items-section";

export default function Overview() {
  return (
    <AdminLayoutBox>
      <HeaderSection />
      <hr />
      <VendorWarehouseSection />
      <hr />
      <OrderItemsSection />
    </AdminLayoutBox>
  );
}
