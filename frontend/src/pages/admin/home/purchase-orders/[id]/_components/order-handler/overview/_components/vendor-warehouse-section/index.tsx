import { useLanguage } from "@/context/LanguageContext";
import useWarehouseHelpers from "@/hooks/useWarehouseHelpers";
import paths from "@/utils/constants/paths";
import { Link } from "react-router-dom";
import { useOrder } from "../../../../../context";

export default function VendorWarehouseSection() {
  const { translate } = useLanguage();

  const { getWarehouseNameById } = useWarehouseHelpers();

  const { order } = useOrder();

  return (
    <section className="flex flex-col gap-2 text-gray-600">
      <div className="flex items-center gap-1.5">
<<<<<<< HEAD
        {translate("Supplier (Vendor)", "المورد (البائع)")}:
=======
        {translate("Vendor", "البائع")}:
>>>>>>> 368811657e0eba1f2e8b46ee732d01745194d628
        {order.vendor ? (
          <Link
            target="_blank"
            to={`/${paths.admin}/${paths.home}/${paths.vendors}/${order.vendor._id}`}
            className="font-medium text-gray-800 hover:underline"
          >
            {order.vendor.name}
          </Link>
        ) : (
          <span className="font-medium text-gray-500">{translate("Deleted Vendor", "بائع محذوف")}</span>
        )}
      </div>
      <div className="flex items-center gap-1.5">
<<<<<<< HEAD
        {translate("Sub Account (Vendor No.)", "الحساب الفرعي (رقم البائع)")}:
        <span className="font-medium text-gray-800">{order.vendor?.vendorNumber ?? "-"}</span>
      </div>
      <div className="flex items-center gap-1.5">
=======
>>>>>>> 368811657e0eba1f2e8b46ee732d01745194d628
        {translate("Warehouse", "المخزن")}:
        <span className="font-medium text-gray-800">{getWarehouseNameById(order.warehouseId)}</span>
      </div>
    </section>
  );
}
