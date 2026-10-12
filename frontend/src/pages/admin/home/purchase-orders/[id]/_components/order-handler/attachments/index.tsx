import useHasPermission from "@/hooks/useHasPermission";
import AttachmentsPanel from "@/components/global/attachments/attachments-panel";
import { useOrder } from "../../../context";

/** The order's PDF attachments (adding or removing one never changes the order or its accounting). */
export default function Attachments() {
  const { order } = useOrder();
  const canEdit = useHasPermission("purchaseOrders", "update");
  return <AttachmentsPanel ownerKey="purchase-orders" ownerId={order._id} canEdit={canEdit} />;
}
