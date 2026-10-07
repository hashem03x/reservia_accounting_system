import AdminLayoutBox from "@/components/ui/admin-layout-box";
import OrderJournalEntriesSection from "@/components/global/order-journal-entries-section";
import { useLanguage } from "@/context/LanguageContext";
import { useOrder } from "../../../context";

export default function Accounting() {
  const { translate } = useLanguage();
  const { order } = useOrder();

  return (
    <AdminLayoutBox header={{ title: translate("Accounting / Journal Entries", "المحاسبة / القيود اليومية") }}>
      <OrderJournalEntriesSection orderType="purchase-order" orderId={order._id} />
    </AdminLayoutBox>
  );
}
