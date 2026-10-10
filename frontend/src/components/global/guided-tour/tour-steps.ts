import paths from "@/utils/constants/paths";
import { Action, Resource, UserState } from "@/types/user";
import { isAdmin, isCustomer } from "@/utils/constants/roles";

// The admin dashboard's guided tour - every step in one place, built from the real routes in
// App.tsx and the sidebar (all-admin-options). A step may navigate to a route and highlight an
// element marked with `data-tour="<target>"` (never a CSS class). Steps the user cannot access are
// left out; a target that is not on screen (collapsed sidebar, phone layout, empty page) is shown
// as a centered card instead, so the tour never gets stuck. To add a page, add a step here and a
// `data-tour` attribute on the element it points at.

export type TourText = { en: string; ar: string };
export type TourAccess = { resource: Resource; action: Action } | "admin";
export interface TourStep {
  id: string;
  route?: string;
  target?: string;
  title: TourText;
  body: TourText;
  access?: TourAccess;
}

const admin = (...segments: string[]) => `/${[paths.admin, ...segments].join("/")}`;
const read = (resource: Resource): TourAccess => ({ resource, action: "read" as Action });

export const TOUR_STEPS: TourStep[] = [
  {
    id: "welcome",
    title: { en: "Welcome to Reservia", ar: "مرحباً بك في ريزرفيا" },
    body: {
      en: 'A short tour of the dashboard, its modules and how they fit the accounting workflow. Use Next / Back, or the arrow keys; Esc closes it. You can restart it any time from "Make a tour" in the sidebar.',
      ar: 'جولة قصيرة في لوحة التحكم ووحداتها وكيف تتكامل مع الدورة المحاسبية. استخدم التالي / السابق أو الأسهم؛ و Esc للإغلاق. يمكنك إعادتها في أي وقت من "Make a tour" في القائمة الجانبية.',
    },
  },
  {
    id: "sidebar",
    target: "admin-sidebar",
    title: { en: "Navigation", ar: "التنقل" },
    body: {
      en: "Every module is in this sidebar. It can be collapsed to icons with the arrow at the top.",
      ar: "كل الوحدات في هذه القائمة الجانبية، ويمكن طيها إلى أيقونات بالسهم في الأعلى.",
    },
  },
  {
    id: "home-kpis",
    route: admin(paths.home),
    target: "home-kpis",
    title: { en: "Dashboard summary", ar: "ملخص لوحة التحكم" },
    body: {
      en: "Key figures from the ledger: revenue, expenses, receivables, payables and cash - with quick actions just below.",
      ar: "أرقام أساسية من دفتر الأستاذ: الإيرادات والمصروفات والمدينون والدائنون والنقدية - مع إجراءات سريعة أسفلها.",
    },
  },
  {
    id: "vendors",
    route: admin(paths.home, paths.vendors),
    target: "page-header",
    access: read("vendors"),
    title: { en: "Vendors", ar: "الموردون" },
    body: {
      en: "Suppliers and their Vendor Numbers (the Sub Account on journal lines). A vendor's page shows its orders, payments, fixed asset acquisitions and a link to its ledger account statement.",
      ar: "الموردون وأرقامهم (الحساب الفرعي في القيود). صفحة المورد تعرض أوامره ومدفوعاته واقتناء الأصول الثابتة منه ورابط كشف حسابه.",
    },
  },
  {
    id: "purchase-orders",
    route: admin(paths.home, paths.purchaseOrders),
    target: "page-header",
    access: read("purchaseOrders"),
    title: { en: "Purchase Orders", ar: "أوامر الشراء" },
    body: {
      en: "Each Purchase Order belongs to a project: materials and services go straight to that project's PUC (Projects Under Construction), and the vendor is credited.",
      ar: "كل أمر شراء يتبع مشروعاً: المواد والخدمات تذهب مباشرة إلى مشروعات تحت التنفيذ لذلك المشروع، ويُقيد المورد دائناً.",
    },
  },
  {
    id: "products",
    route: admin(paths.home, paths.products),
    target: "page-header",
    access: read("products"),
    title: { en: "Products and inventory", ar: "المنتجات والمخزون" },
    body: {
      en: "Stock per warehouse and product cost. \"PUC Transfer\" moves a product's stock into a project's PUC, or from one project to another, with its journal entry.",
      ar: 'المخزون لكل فرع وتكلفة المنتج. "تحويل لمشروعات تحت التنفيذ" ينقل مخزون المنتج إلى مشروع أو من مشروع لآخر مع قيده.',
    },
  },
  {
    id: "sales-orders",
    route: admin(paths.home, paths.salesOrders),
    target: "page-header",
    title: { en: "Sales Orders", ar: "أوامر البيع" },
    body: {
      en: "A Sales Order recognizes the project's revenue (excluding VAT) and loads its costs from PUC by the executed percentage.",
      ar: "أمر البيع يثبت إيراد المشروع (بدون ضريبة القيمة المضافة) ويحمّل تكاليفه من مشروعات تحت التنفيذ بنسبة التنفيذ.",
    },
  },
  {
    id: "customers",
    route: admin(paths.home, paths.customers),
    target: "page-header",
    title: { en: "Customers", ar: "العملاء" },
    body: {
      en: "Customers and their Customer Numbers, used as the Sub Account of receivable lines.",
      ar: "العملاء وأرقامهم، المستخدمة كحساب فرعي في سطور المدينين.",
    },
  },
  {
    id: "expenses",
    route: admin(paths.home, paths.expenses),
    target: "expenses-filters",
    title: { en: "Expenses", ar: "المصروفات" },
    body: {
      en: 'Vendor expenses with VAT, payments and their journal entries. Filter by Expense Category and date; the "Expenses by Category" report totals them.',
      ar: 'مصروفات الموردين بالضريبة والمدفوعات وقيودها. فلتر حسب تصنيف المصروف والتاريخ؛ وتقرير "المصروفات حسب التصنيف" يجمعها.',
    },
  },
  {
    id: "expense-categories",
    route: admin(paths.expenseCategories),
    target: "page-header",
    access: "admin",
    title: { en: "Expense Categories", ar: "تصنيفات المصروفات" },
    body: {
      en: "Create, rename and deactivate the categories expenses are analyzed by. A category in use is deactivated, never deleted.",
      ar: "إنشاء وتعديل وإيقاف التصنيفات التي تُحلل بها المصروفات. التصنيف المستخدم يُوقف ولا يُحذف.",
    },
  },
  {
    id: "warehouses",
    route: admin(paths.home, paths.warehouses),
    target: "page-header",
    access: read("warehouses"),
    title: { en: "Warehouses", ar: "الفروع" },
    body: {
      en: "Where stock is held; transfers move it between warehouses.",
      ar: "أماكن حفظ المخزون؛ والتحويلات تنقله بين الفروع.",
    },
  },
  {
    id: "fixed-assets",
    route: admin(paths.fixedAssets),
    target: "page-header",
    access: read("fixedAssets"),
    title: { en: "Fixed Assets and depreciation", ar: "الأصول الثابتة والإهلاك" },
    body: {
      en: "Each asset is capitalized against its vendor. Its Payments tab settles the vendor (investing cash flows), and the monthly depreciation run posts to the expense and accumulated depreciation accounts.",
      ar: "كل أصل يُرسمل على مورده. تبويب المدفوعات يسدد المورد (تدفقات استثمارية)، وتشغيل الإهلاك الشهري يرحّل لحسابي المصروف ومجمع الإهلاك.",
    },
  },
  {
    id: "projects",
    route: admin(paths.projects),
    target: "page-header",
    access: read("projects"),
    title: { en: "Projects", ar: "المشروعات" },
    body: {
      en: "Contract value, executed percentage and costs per project. Project profitability shows revenue details and each project's PUC balance.",
      ar: "قيمة العقد ونسبة التنفيذ والتكاليف لكل مشروع. ربحية المشروعات تعرض تفاصيل الإيرادات ورصيد مشروعات تحت التنفيذ لكل مشروع.",
    },
  },
  {
    id: "accounts",
    route: admin(paths.accounts),
    target: "page-header",
    access: read("accounts"),
    title: { en: "Chart of Accounts", ar: "دليل الحسابات" },
    body: {
      en: "Every account, its type and classification. Reports, cash flow and tax analysis read these classifications.",
      ar: "كل حساب ونوعه وتصنيفه. التقارير والتدفقات النقدية والتحليل الضريبي تعتمد على هذه التصنيفات.",
    },
  },
  {
    id: "journal-entries",
    route: admin(paths.journalEntries),
    target: "page-header",
    access: read("journalEntries"),
    title: { en: "Journal Entries", ar: "القيود اليومية" },
    body: {
      en: "All entries in Entry Number order. A manual entry needs a project, a description on every line and a Sub Account on customer / vendor accounts; posted entries are corrected by reversal only.",
      ar: "كل القيود بترتيب رقم القيد. القيد اليدوي يحتاج مشروعاً ووصفاً لكل بند وحساباً فرعياً لحسابات العملاء والموردين؛ والقيود المرحلة تُصحح بالعكس فقط.",
    },
  },
  {
    id: "advanced-payments",
    route: admin(paths.advancedPayments),
    target: "page-header",
    access: read("advancedPayments"),
    title: { en: "Advanced Payments", ar: "الدفعات المقدمة" },
    body: {
      en: "Advances received from customers and paid to vendors, and how much of each has been used.",
      ar: "الدفعات المقدمة من العملاء وللموردين وما استُخدم منها.",
    },
  },
  {
    id: "shareholders",
    route: admin(paths.shareholders),
    target: "page-header",
    access: read("shareholders"),
    title: { en: "Shareholders", ar: "المساهمون" },
    body: {
      en: "Capital contributions, posted to equity (financing cash flows).",
      ar: "مساهمات رأس المال المرحلة لحقوق الملكية (تدفقات تمويلية).",
    },
  },
  {
    id: "financial-reports",
    route: admin(paths.financialReports),
    target: "page-header",
    access: read("reports"),
    title: { en: "Financial Reports", ar: "التقارير المالية" },
    body: {
      en: "General Ledger line items (by account number), Trial Balance, Profit or Loss, Financial Position, Cash Flow (operating / investing / financing), project reports including the PUC / Project Cost report, customer and supplier reports, Expenses by Category and the Tax reports - all from posted journal entries, exportable to Excel and PDF.",
      ar: "دفتر الأستاذ العام التفصيلي (برقم الحساب) وميزان المراجعة وقائمة الدخل والمركز المالي والتدفقات النقدية (تشغيلية / استثمارية / تمويلية) وتقارير المشروعات ومنها تقرير تكاليف المشروعات والعملاء والموردين والمصروفات حسب التصنيف وتقارير الضرائب - كلها من القيود المرحلة، مع التصدير إلى Excel و PDF.",
    },
  },
  {
    id: "analytics",
    route: admin(paths.analytics),
    target: "page-header",
    access: read("analytics"),
    title: { en: "Analytics", ar: "التحليلات" },
    body: {
      en: "Financial KPIs for any period compared with the previous one: profitability, liquidity, solvency and efficiency, with charts.",
      ar: "مؤشرات مالية لأي فترة مقارنة بالسابقة: الربحية والسيولة والملاءة والكفاءة، مع رسوم بيانية.",
    },
  },
  {
    id: "accounting-periods",
    route: admin(paths.accountingPeriods),
    target: "page-header",
    access: "admin",
    title: { en: "Accounting Periods", ar: "الفترات المحاسبية" },
    body: {
      en: "Close a month to lock it: no entry dated in it can be created, edited or reversed until an administrator reopens it.",
      ar: "أغلق الشهر لقفله: لا يمكن إنشاء أو تعديل أو عكس أي قيد بتاريخ داخله حتى يعيد المسؤول فتحه.",
    },
  },
  {
    id: "finish",
    target: "make-a-tour",
    title: { en: "That's the tour", ar: "انتهت الجولة" },
    body: {
      en: 'Restart it whenever you like with "Make a tour" at the bottom of the sidebar.',
      ar: 'يمكنك إعادتها متى شئت من "Make a tour" أسفل القائمة الجانبية.',
    },
  },
];

/** Same rules as useHasPermission, for a list of steps. */
export function canAccess(user: UserState | null, access?: TourAccess) {
  if (!access) return true;
  if (!user || isCustomer(user.role)) return false;
  if (isAdmin(user.role)) return true;
  if (access === "admin") return false;
  return !!user.permissions?.find((p) => p.resource === access.resource)?.actions.includes(access.action);
}

export const stepsFor = (user: UserState | null) => TOUR_STEPS.filter((step) => canAccess(user, step.access));
