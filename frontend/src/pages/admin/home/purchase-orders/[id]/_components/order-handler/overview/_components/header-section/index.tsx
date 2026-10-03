import { useLanguage } from "@/context/LanguageContext";
import { formatDateAndTime } from "@/utils/helpers/date-formaters";
import paths from "@/utils/constants/paths";
import { Link } from "react-router-dom";
import { Button, Menu } from "@mantine/core";
import { outlineIcons } from "@/components/icons";
import InfoItem from "@/components/ui/info-item";
import { useOrder } from "../../../../../context";
import { PrintBarcodes } from "./_components/print-barcodes";
import PrintInvoice from "./_components/print-invoice";
import PrintReceipt from "./_components/print-receipt";

export default function HeaderSection() {
  const { translate, language, translations } = useLanguage();
  const { order, orderPaymentStatusElement } = useOrder();

  return (
    <header className="flex flex-wrap items-start justify-between gap-2">
      <div className="flex flex-col gap-2">
        <h1>{translate("Overview", "نظرة عامة")}</h1>
        <InfoItem label={translate("Order ID", "رقم الطلب")} value={order._id} />
        <InfoItem label={translate("Payment Status", "حالة الدفع")} value={orderPaymentStatusElement} />
        <InfoItem
          label={translate("Order Total Amount", "اجمالى سعر الطلب")}
          value={`${order.totalAmount.toFixed(2)} ${translations.currency}`}
        />
        {order.project && (
          <InfoItem label={translate("Project", "المشروع")} value={order.project.projectNumber} />
        )}
        {!!order.vatPercentage && (
          <InfoItem
            label={translate("VAT", "ضريبة القيمة المضافة")}
            value={`(${order.vatPercentage}%) ${(order.vatAmount || 0).toFixed(2)} ${translations.currency}`}
          />
        )}
        {!!order.withholdingTaxPercentage && (
          <InfoItem
            label={translate("Withholding Tax", "ضريبة الخصم")}
            value={`(${order.withholdingTaxPercentage}%) -${(order.withholdingTaxAmount || 0).toFixed(2)} ${translations.currency}`}
          />
        )}
        {(!!order.vatPercentage || !!order.withholdingTaxPercentage) && (
          <InfoItem
            label={translate("Total (incl. VAT/Withholding)", "الإجمالي (شامل الضريبة)")}
            value={`${(order.grandTotal ?? order.totalAmount).toFixed(2)} ${translations.currency}`}
          />
        )}
        {order.paymentMethod === "account" && order.paymentAccount && (
          <InfoItem
            label={translate("Payment Account", "حساب الدفع")}
            value={`${order.paymentAccount.code} - ${order.paymentAccount.name}`}
          />
        )}
        <InfoItem
          label={translate("Order Created At", "تم انشاء الطلب في")}
          value={formatDateAndTime(order.createdAt, language)}
        />
        {order.createdBy && (
          <InfoItem
            label={translate("Order Created By", "تم انشاء الطلب بواسطة")}
            value={
              <Link to={`/${paths.admin}/${paths.users}/${order.createdBy._id}`} className="hover:underline">
                {order.createdBy.name}
              </Link>
            }
          />
        )}
      </div>

      {/* Printing */}
      <div className="flex flex-col gap-2">
        <Menu withArrow width={200} radius={7.5} shadow="md">
          <Menu.Target>
            <Button color="dark" variant="light" radius="md" leftSection={<outlineIcons.Print size={18} />}>
              {translate("Print", "طباعة")}
            </Button>
          </Menu.Target>

          <Menu.Dropdown dir={translations.dir}>
            <PrintBarcodes />
            <PrintInvoice />
            <PrintReceipt />
          </Menu.Dropdown>
        </Menu>
      </div>
    </header>
  );
}
