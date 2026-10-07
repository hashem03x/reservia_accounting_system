import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import paths from "@/utils/constants/paths";
import { Link } from "react-router-dom";

export default function Reports() {
  const { translations, translate } = useLanguage();

  useDocumentTitle(`${translations.pages.reports} | ${translations.adminPanel}`);

  const renderReportLink = (to: string, title: string) => {
    return (
      <Link className="text-blue-500 hover:underline" to={to}>
        {title}
      </Link>
    );
  };

  return (
    <AdminLayoutBox header={{ title: translations.pages.reports }}>
      <div className="flex flex-col gap-2">
        {renderReportLink(paths.vendors, translate("Vendors Report", "تقرير البائعين"))}
        {renderReportLink(paths.customers, translate("Customers Report", "تقرير العملاء"))}
        {renderReportLink(
          `${paths.purchaseOrders}?sortBy=createdAt&sortOrder=desc`,
          translate("Purchase Orders Report", "تقرير طلبات الشراء"),
        )}
        {renderReportLink(
          `${paths.salesOrders}?sortBy=createdAt&sortOrder=desc`,
          translate("Sales Orders Report", "تقرير طلبات البيع"),
        )}
        {renderReportLink(
          `${paths.products}?sortBy=createdAt&sortOrder=desc`,
          translate("Products Report", "تقرير المنتجات"),
        )}
        {renderReportLink(
          `${paths.inventoryTransfer}?sortBy=date&sortOrder=desc`,
          translate("Inventory Transfer Report", "تقرير نقل المخزون"),
        )}
        {renderReportLink(
          `${paths.inventorySummary}?sortBy=sku&sortOrder=desc`,
          translate("Inventory Summary Report", "تقرير ملخص المخزون"),
        )}
        {renderReportLink(
          `${paths.expenses}?sortBy=createdAt&sortOrder=desc`,
          translate("Expenses Report", "تقرير المصروفات"),
        )}
        {renderReportLink(
          `${paths.payments}?sortBy=createdAt&sortOrder=desc`,
          translate("Payments Report", "تقرير المدفوعات"),
        )}
        {renderReportLink(`${paths.treasuryBalance}`, translate("Treasury Balance Report", "تقرير رصيد الخزينة"))}
        {renderReportLink(
          `${paths.profitBySales}?sortBy=createdAt`,
          translate("Profit by Sales Report", "تقرير الربح من المبيعات"),
        )}
        {renderReportLink(`${paths.profitByCustomer}`, translate("Profit by Customer Report", "تقرير الربح حسب العملاء"))}
        {renderReportLink(
          `${paths.profitByProduct}?sortBy=createdAt`,
          translate("Profit by Product Report", "تقرير الربح حسب المنتج"),
        )}
        {renderReportLink(
          `${paths.returns}?sortBy=createdAt&sortOrder=desc`,
          translate("Returns Report", "تقرير المرتجعات"),
        )}
        {renderReportLink(
          `${paths.fixedAssets}?sortBy=createdAt&sortOrder=desc`,
          translate("Fixed Assets Report", "تقرير الأصول الثابتة"),
        )}
        {renderReportLink(`${paths.incomeStatement}`, translate("Income Statement Report", "تقرير قائمة الدخل"))}
        {renderReportLink(`${paths.balanceSheet}`, translate("Balance Sheet Report", "تقرير ملخص الرصيد"))}
      </div>
    </AdminLayoutBox>
  );
}
