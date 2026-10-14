// The applied-filters line of a report (on screen and in print) in the page language: each filter's
// name and, for the filters with fixed options, the option's label - never the raw query key or code.

type Translate = (en: string, ar: string) => string;

const FILTER_NAMES: Record<string, [string, string]> = {
  customer: ["Customer", "العميل"],
  vendor: ["Supplier", "المورد"],
  project: ["Project", "المشروع"],
  sector: ["Sector", "القسم"],
  projectStatus: ["Project Status", "حالة المشروع"],
  account: ["Account", "الحساب"],
  expenseType: ["Accounts", "الحسابات"],
  orderStatus: ["Order Status", "حالة الأمر"],
  paymentStatus: ["Payment Status", "حالة الدفع"],
  assetStatus: ["Asset Status", "حالة الأصل"],
  assetClass: ["Asset Type", "نوع الأصل"],
  termDays: ["Credit terms (days)", "مدة الائتمان (أيام)"],
  entryNumber: ["Entry No.", "رقم القيد"],
  search: ["Search", "بحث"],
  sort: ["Sort", "الترتيب"],
  category: ["Category", "الفئة"],
  source: ["Source Document", "نوع المستند"],
  movement: ["Movement Type", "نوع الحركة"],
  reference: ["Document No.", "رقم المستند"],
  byProject: ["Break down by project", "تفصيل حسب المشروع"],
  includeZero: ["Include accounts without balances", "إظهار الحسابات بدون أرصدة"],
};

const VALUE_LABELS: Record<string, [string, string]> = {
  true: ["Yes", "نعم"],
  false: ["No", "لا"],
  __none__: ["No sector", "بدون قسم"],
  active: ["Active", "نشط"],
  completed: ["Completed", "مكتمل"],
  on_hold: ["On Hold", "متوقف"],
  cancelled: ["Cancelled", "ملغي"],
  canceled: ["Canceled", "ملغي"],
  expense: ["Expenses", "المصروفات"],
  cogs: ["Cost of sales", "تكلفة المبيعات"],
  all: ["Expenses + cost of sales", "المصروفات + تكلفة المبيعات"],
  pending: ["Pending", "قيد التنفيذ"],
  delivered: ["Delivered", "تم التسليم"],
  unpaid: ["Unpaid", "غير مدفوع"],
  partial: ["Partially paid", "مدفوع جزئياً"],
  paid: ["Paid", "مدفوع"],
  fully_depreciated: ["Fully depreciated", "مهلك بالكامل"],
  under_maintenance: ["Under maintenance", "تحت الصيانة"],
  disposed: ["Disposed", "مستبعد"],
  tangible: ["Tangible", "ملموس"],
  intangible: ["Intangible", "غير ملموس"],
  date: ["Date (oldest first)", "التاريخ (الأقدم أولاً)"],
  "-date": ["Date (newest first)", "التاريخ (الأحدث أولاً)"],
  entryNumber: ["Entry number", "رقم القيد"],
  "-entryNumber": ["Entry number (descending)", "رقم القيد (تنازلي)"],
  "-amount": ["Amount (largest first)", "المبلغ (الأكبر أولاً)"],
  amount: ["Amount (smallest first)", "المبلغ (الأصغر أولاً)"],
  materials: ["Materials", "مواد"],
  labor: ["Labor", "عمالة"],
  design: ["Designs and Engineering", "التصميمات والهندسة"],
  equipment: ["Equipment", "معدات"],
  subcontractors: ["Subcontractors", "مقاولو الباطن"],
  services: ["Services", "خدمات"],
  other: ["Other Project Costs", "تكاليف أخرى للمشروع"],
  "Purchase Order": ["Purchase Invoice", "فاتورة مشتريات"],
  Inventory: ["PUC Transfer", "تحويل مشروعات تحت التنفيذ"],
  "Sales Order": ["Sales Invoice", "فاتورة مبيعات"],
  Project: ["Project", "مشروع"],
  Manual: ["Manual entry", "قيد يدوي"],
  Reversal: ["Reversal", "قيد عكسي"],
  invoice: ["Tax on a document", "ضريبة على مستند"],
  reversal: ["Reversal", "قيد عكسي"],
  payment: ["Payment / refund", "سداد / استرداد"],
  offset: ["Settlement between tax accounts", "تسوية بين حسابات الضرائب"],
  adjustment: ["Manual entry / adjustment", "قيد يدوي / تسوية"],
  SO: ["Sales Invoice", "فاتورة مبيعات"],
  PO: ["Purchase Invoice", "فاتورة مشتريات"],
  EXPENSE: ["Expense", "مصروف"],
  FIXED_ASSET: ["Fixed Asset", "أصل ثابت"],
  MANUAL: ["Manual journal entry", "قيد يدوي"],
  OTHER: ["Other automatic entry", "قيد آلي آخر"],
};

const OBJECT_ID = /^[a-f0-9]{24}$/i;

/** "Name: value" for one applied filter, in the page language. */
export function filterLine(key: string, value: string, translate: Translate): string {
  const name = FILTER_NAMES[key] ? translate(...FILTER_NAMES[key]) : key;
  // A selected record (project, customer, account ...) - its id means nothing to a reader.
  if (OBJECT_ID.test(value)) return `${name}: ${translate("selected", "محدد")}`;
  // Sort and search values are free text / codes only for some keys; fixed options get their label.
  const label =
    key !== "search" && key !== "reference" && key !== "entryNumber" && VALUE_LABELS[value]
      ? translate(...VALUE_LABELS[value])
      : value;
  return `${name}: ${label}`;
}
