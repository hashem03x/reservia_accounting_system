import { Language } from "@/types/language";
import { LocalizedEntity } from "@/types/global";
import { ExpenseCategory } from "@/types/expense";
import translate from "@/utils/helpers/translate";

const expenseCategories: LocalizedEntity<ExpenseCategory> = {
  "office-supplies": {
    value: "office-supplies",
    label: {
      en: "Office Supplies",
      ar: "لوازم مكتبية",
    },
  },
  "finance-charges": {
    value: "finance-charges",
    label: {
      en: "Finance Charges",
      ar: "رسوم مالية",
    },
  },
  "operating-expenses": {
    value: "operating-expenses",
    label: {
      en: "Operating Expenses",
      ar: "نفقات التشغيل",
    },
  },
  "management-expenses": {
    value: "management-expenses",
    label: {
      en: "Management Expenses",
      ar: "نفقات الإدارة",
    },
  },
  salaries: {
    value: "salaries",
    label: {
      en: "Salaries",
      ar: "رواتب",
    },
  },
  marketing: {
    value: "marketing",
    label: {
      en: "Marketing",
      ar: "تسويق",
    },
  },
  travel: {
    value: "travel",
    label: {
      en: "Travel",
      ar: "سفر",
    },
  },
  utilities: {
    value: "utilities",
    label: {
      en: "Utilities",
      ar: "مرافق",
    },
  },
  rent: {
    value: "rent",
    label: {
      en: "Rent",
      ar: "إيجار",
    },
  },
  dividend: {
    value: "dividend",
    label: {
      en: "Dividend",
      ar: "توزيعات ارباح",
    },
  },
  "cleaning-and-hosting": {
    value: "cleaning-and-hosting",
    label: {
      en: "Cleaning & Hosting",
      ar: "ضيافة ونظافة",
    },
  },
  others: {
    value: "others",
    label: {
      en: "Others",
      ar: "أخرى",
    },
  },
};

export default expenseCategories;

export const expenseCategoriesArray = Object.values(expenseCategories);

// ================ Helpers ================

export function getExpenseCategoryLabel(category: ExpenseCategory, language: Language) {
  return translate(language, expenseCategories[category].label.en, expenseCategories[category].label.ar);
}
