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
        {order.customer ? (
          <Link
            target="_blank"
            to={`/${paths.admin}/${paths.home}/${paths.customers}/${order.customer._id}`}
            className="font-medium text-gray-800 hover:underline"
          >
            {order.customer.name}
          </Link>
        ) : (
          <span className="font-medium text-gray-500">{translate("Deleted Customer", "عميل محذوف")}</span>
        )}
      </div>
      {/* The customer's number is the Sub Account on every journal entry line of this order. */}
      {order.customer && (
        <div className="flex items-center gap-1.5">
          {translate("Sub Account (Customer No.)", "الحساب الفرعي (رقم العميل)")}:
          <span className="font-medium text-gray-800">{order.customer.customerNumber ?? translate("Not assigned", "غير محدد")}</span>
        </div>
      )}
      {!isWebsiteOrder(order.orderSource) && (
        <div className="flex items-center gap-1.5">
          {translate("Warehouse", "المخزن")}:
          <span className="font-medium text-gray-800">{getWarehouseNameById(order.warehouse)}</span>
        </div>
      )}
    </section>
  );
}
