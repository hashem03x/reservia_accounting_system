import { useLanguage } from "@/context/LanguageContext";
import useWarehouseHelpers from "@/hooks/useWarehouseHelpers";
import paths from "@/utils/constants/paths";
import { Link } from "react-router-dom";
import { useOrder } from "../../../../../context";
import { isWebsiteOrder } from "@/utils/constants/order-sources";

export default function CustomerWarehouseSection() {
  const { translate } = useLanguage();

  const { getWarehouseNameById } = useWarehouseHelpers();

  const { order } = useOrder();

  return (
    <section className="flex flex-col gap-2 text-gray-600">
      <div className="flex items-center gap-1.5">
        {translate("Customer", "العميل")}:
        <Link
          target="_blank"
          to={`/${paths.admin}/${paths.home}/${paths.customers}/${order.customer._id}`}
          className="font-medium text-gray-800 hover:underline"
        >
          {order.customer.name}
        </Link>
      </div>
      {!isWebsiteOrder(order.orderSource) && (
        <div className="flex items-center gap-1.5">
          {translate("Warehouse", "المخزن")}:
          <span className="font-medium text-gray-800">{getWarehouseNameById(order.warehouse)}</span>
        </div>
      )}
    </section>
  );
}
