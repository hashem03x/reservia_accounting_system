import AdminLayoutBox from "@/components/ui/admin-layout-box";
import OrderDocumentsSection from "@/components/global/order-documents-section";
import useHasPermission from "@/hooks/useHasPermission";
import resources from "@/utils/constants/resources";
import actions from "@/utils/constants/actions";
import HeaderSection from "./_components/header-section";
import VendorWarehouseSection from "./_components/vendor-warehouse-section";
import OrderItemsSection from "./_components/order-items-section";
import { useOrder } from "../../../context";

export default function Overview() {
  const { order, setOrder } = useOrder();
  const canManageDocuments = useHasPermission(resources.purchaseOrders, actions.update);

  return (
    <AdminLayoutBox>
      <HeaderSection />
      <hr />
      <VendorWarehouseSection />
      <hr />
      <OrderItemsSection />
      <hr />
      <OrderDocumentsSection
        apiBase="purchaseOrder"
        orderId={order._id}
        documents={order.documents}
        onChange={(documents) => setOrder((prev) => ({ ...prev, documents }))}
        canManage={canManageDocuments}
      />
    </AdminLayoutBox>
  );
}
