import { LocalizedEntity } from "@/types/global";
import { Resource } from "@/types/user";

const resources: LocalizedEntity<Resource> = {
  vendors: {
    value: "vendors",
    label: {
      en: "Vendors",
      ar: "البائعون",
    },
  },
  products: {
    value: "products",
    label: {
      en: "Products",
      ar: "المنتجات",
    },
  },
  purchaseOrders: {
    value: "purchaseOrders",
    label: {
      en: "Purchase Orders",
      ar: "طلبات الشراء",
    },
  },
  salesOrders: {
    value: "salesOrders",
    label: {
      en: "Sales Orders",
      ar: "طلبات البيع",
    },
  },
  customers: {
    value: "customers",
    label: {
      en: "Customers",
      ar: "العملاء",
    },
  },
  expenses: {
    value: "expenses",
    label: {
      en: "Expenses",
      ar: "النفقات",
    },
  },
  warehouses: {
    value: "warehouses",
    label: {
      en: "Warehouses",
      ar: "المخازن",
    },
  },
  transfers: {
    value: "transfers",
    label: {
      en: "Transfers",
      ar: "التحويلات",
    },
  },
  categories: {
    value: "categories",
    label: {
      en: "Categories",
      ar: "الفئات",
    },
  },
  subcategories: {
    value: "subcategories",
    label: {
      en: "Subcategories",
      ar: "الفئات الفرعية",
    },
  },
  reports: {
    value: "reports",
    label: {
      en: "Reports",
      ar: "التقارير",
    },
  },
  cash: {
    value: "cash",
    label: {
      en: "Cash",
      ar: "النقدية",
    },
  },
  currencies: {
    value: "currencies",
    label: {
      en: "Currencies",
      ar: "العملات",
    },
  },
  coupons: {
    value: "coupons",
    label: {
      en: "Coupons",
      ar: "الكوبونات",
    },
  },
  customization: {
    value: "customization",
    label: {
      en: "Customization",
      ar: "التخصيص",
    },
  },
  governorates: {
    value: "governorates",
    label: {
      en: "Governorates",
      ar: "المحافظات",
    },
  },
  transactions: {
    value: "transactions",
    label: {
      en: "Transactions",
      ar: "المعاملات",
    },
  },
  users: {
    value: "users",
    label: {
      en: "Users",
      ar: "المستخدمون",
    },
  },
  analytics: {
    value: "analytics",
    label: {
      en: "Analytics",
      ar: "التحليلات",
    },
  },
  fixedAssets: {
    value: "fixedAssets",
    label: {
      en: "Fixed Assets",
      ar: "الأصول الثابتة",
    },
  },
  databaseExport: {
    value: "databaseExport",
    label: {
      en: "Database Export",
      ar: "تصدير قاعدة البيانات",
    },
  },
  projects: {
    value: "projects",
    label: {
      en: "Projects",
      ar: "المشاريع",
    },
  },
  accounts: {
    value: "accounts",
    label: {
      en: "Chart of Accounts",
      ar: "دليل الحسابات",
    },
  },
  journalEntries: {
    value: "journalEntries",
    label: {
      en: "Journal Entries",
      ar: "القيود اليومية",
    },
  },
  advancedPayments: {
    value: "advancedPayments",
    label: {
      en: "Advanced Payments",
      ar: "الدفعات المقدمة",
    },
  },
};

export default resources;

export const resourcesArray = Object.values(resources);
