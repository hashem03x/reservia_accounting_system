import { Language } from "@/types/language";
import { LocalizedEntity } from "@/types/global";
import { PaymentCategory } from "@/types/payment";
import translate from "@/utils/helpers/translate";

const paymentCategories: LocalizedEntity<PaymentCategory> = {
  purchase: {
    value: "purchase",
    label: {
      en: "Purchase",
      ar: "مشتريات",
    },
  },
  "purchase-return": {
    value: "purchase-return",
    label: {
      en: "Purchase Return",
      ar: "إرجاع مشتريات",
    },
  },
  sales: {
    value: "sales",
    label: {
      en: "Sales",
      ar: "مبيعات",
    },
  },
  "sales-return": {
    value: "sales-return",
    label: {
      en: "Sales Return",
      ar: "إرجاع مبيعات",
    },
  },
  expense: {
    value: "expense",
    label: {
      en: "Expenses",
      ar: "نفقات",
    },
  },
  transfer: {
    value: "transfer",
    label: {
      en: "Transfer",
      ar: "تحويل",
    },
  },
  "finance-charges": {
    value: "finance-charges",
    label: {
      en: "Finance Charges",
      ar: "رسوم مالية",
    },
  },
  "currency-transfer": {
    value: "currency-transfer",
    label: {
      en: "Currency Transfer",
      ar: "تحويل عملة",
    },
  },
};

export default paymentCategories;

export const paymentCategoriesArray = Object.values(paymentCategories);

// ================ Helpers ================

export function getPaymentCategoryLabel(category: PaymentCategory, language: Language) {
  return translate(language, paymentCategories[category].label.en, paymentCategories[category].label.ar);
}
