import { isWebsiteOrder } from "@/utils/constants/order-sources";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import OrderDocumentsSection from "@/components/global/order-documents-section";
import useHasPermission from "@/hooks/useHasPermission";
import resources from "@/utils/constants/resources";
import actions from "@/utils/constants/actions";
import HeaderSection from "./_components/header-section";
import CustomerWarehouseSection from "./_components/customer-warehouse-section";
import OrderItemsSection from "./_components/order-items-section";
import CostRecognitionSection from "./_components/cost-recognition-section";
import WebsiteDetailsSection from "./_components/website-details-section";
import { useOrder } from "../../../context";

export default function Overview() {
  const { order, setOrder } = useOrder();
  const canManageDocuments = useHasPermission(resources.salesOrders, actions.update);

  return (
    <AdminLayoutBox>
      <HeaderSection />
      <hr />
      <CustomerWarehouseSection />
      <hr />
      <OrderItemsSection />
      <hr />
      <CostRecognitionSection />
      <hr />
      <OrderDocumentsSection
        apiBase="sale-orders"
        orderId={order._id}
        documents={order.documents}
        onChange={(documents) => setOrder((prev) => ({ ...prev, documents }))}
        canManage={canManageDocuments}
      />

      {isWebsiteOrder(order.orderSource) && (
        <>
          <hr />
          <WebsiteDetailsSection />
        </>
      )}
    </AdminLayoutBox>
  );
}
