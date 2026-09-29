import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import paths from "@/utils/constants/paths";
import userImg from "@/assets/user.png";
import productImg from "@/assets/product.png";
import orderImg from "@/assets/shopping-bag.png";
import warehouseImg from "@/assets/warehouse.png";
import transferImg from "@/assets/transfer.png";
import expensesImg from "@/assets/money-up.png";
import BasicLink from "./_components/basic-link";

export default function Home() {
  const { translate, translations } = useLanguage();

  useDocumentTitle(`${translations.pages.home} | ${translations.adminPanel}`);

  const links = [
    {
      to: paths.vendors,
      img: userImg,
      title: translations.pages.vendors,
      subTitle: translate("Manage vendor info and relations", "إدارة معلومات وعلاقات البائعين"),
    },
    {
      to: paths.purchaseOrders,
      img: orderImg,
      title: translations.pages.purchaseOrders,
      subTitle: translate("Organize and oversee purchase orders", "تنظيم والإشراف على طلبات الشراء"),
    },
    {
      to: paths.products,
      img: productImg,
      title: translations.pages.products,
      subTitle: translate("Maintain product catalog and details", "إدارة كتالوج وبيانات المنتجات"),
    },
    {
      to: paths.salesOrders,
      img: orderImg,
      title: translations.pages.salesOrders,
      subTitle: translate("Oversee sales from order to delivery", "الإشراف على المبيعات من الطلب للتسليم"),
    },
    {
      to: paths.customers,
      img: userImg,
      title: translations.pages.customers,
      subTitle: translate("Handle customer profiles and history", "إدارة ملفات وسجلات العملاء"),
    },
  ];

  const moreOptions = [
    {
      to: paths.expenses,
      img: expensesImg,
      title: translations.pages.expenses,
      subTitle: translate("Track and categorize expenses", "تتبع وتصنيف المصروفات"),
    },
    {
      to: paths.warehouses,
      img: warehouseImg,
      title: translations.pages.warehouses,
      subTitle: translate("View and manage warehouses and locations", "عرض وإدارة المخازن والمواقع"),
    },
    {
      to: paths.transfers,
      img: transferImg,
      title: translations.pages.transfers,
      subTitle: translate("Transfer products between warehouses", "نقل المنتجات بين المخازن"),
    },
  ];

  return (
    <AdminLayoutBox
      header={{
        title: translate("Reservia Integrated Energy", "ريزيرفيا للطاقة المتكاملة"),
        subTitle: translate(
          "Centralized control for managing products, orders, vendors, customers, and more.",
          "التحكم المركزي لإدارة المنتجات والطلبات والبائعين والعملاء والمزيد.",
        ),
      }}
    >
      <div className="root-flex-1 flex h-full flex-col justify-between gap-8">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {links.map((link) => (
            <BasicLink key={link.to} link={link} />
          ))}
        </div>

        <div className="flex flex-col gap-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{translate("More Options", "المزيد من الخيارات")}</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {moreOptions.map((link) => (
              <BasicLink key={link.to} link={link} />
            ))}
          </div>
        </div>
      </div>
    </AdminLayoutBox>
  );
}


/**
 * i want to create a new page for fixed assets
 *Get  /fixed-assets?limit=2000&page=1
 * there response body: 
 * {
    "results": 1,
    "paginationResult": {
        "currentPage": 1,
        "limit": 50,
        "numberOfPages": 1
    },
    "data": [
        {
            "_id": "679b7d0a2b12dc858f3519ef",
            "name": "table_2",
            "bookValue": 1000,
            "fairValue": 300,
            "warehouseId": {
                "_id": "67933fb13bf29b9f172eeab0",
                "name": "Sheikh Zayed ",
                "id": "67933fb13bf29b9f172eeab0"
            },
            "createdBy": "67950cd8b44ffade51d0d7e9",
            "createdAt": "2025-01-30T13:22:18.247Z",
            "updatedAt": "2025-01-30T13:22:18.247Z",
            "loseValue": 700,
            "id": "679b7d0a2b12dc858f3519ef"
        }
    ]
}
    check the project code @src especially @App and take @cash as a reference
 */