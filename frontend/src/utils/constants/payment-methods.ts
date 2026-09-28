import { Language } from "@/types/language";
import { LocalizedEntity } from "@/types/global";
import { PaymentMethod, WebsitePaymentMethod } from "@/types/payment";
import translate from "@/utils/helpers/translate";

const paymentMethods: LocalizedEntity<PaymentMethod> = {
  cash: {
    value: "cash",
    label: {
      en: "Cash",
      ar: "نقداً",
    },
  },
  "paymob-online": {
    value: "paymob-online",
    label: {
      en: "Paymob Online",
      ar: "Paymob Online",
    },
  },
  "paymob-offline": {
    value: "paymob-offline",
    label: {
      en: "Paymob Offline",
      ar: "Paymob Offline",
    },
  },
  "main-bank": {
    value: "main-bank",
    label: {
      en: "Main Bank",
      ar: "البنك الرئيسي",
    },
  },
  "Banque Misr Deposit": {
    value: "Banque Misr Deposit",
    label: {
      en: "Banque Misr Deposit",
      ar: "وديعت بنك مصر",
    },
  },
  wallet: {
    value: "wallet",
    label: {
      en: "E Wallet",
      ar: "المحفظة الالكترونية",
    },
  },
  band_transfer: {
    value: "band_transfer",
    label: {
      en: "Bank Transfer",
      ar: "تحويل بنكي",
    },
  },
  instapay: {
    value: "instapay",
    label: {
      en: "Instapay",
      ar: "Instapay",
    },
  },
  fawry: {
    value: "fawry",
    label: {
      en: "Fawry",
      ar: "Fawry",
    },
  },
  // Adding shopify payments method
  "shopify-payments": {
    value: "shopify-payments",
    label: {
      en: "Shopify Payments",
      ar: "Shopify Payments",
    },
  },
};

export default paymentMethods;

export const paymentMethodsArray = Object.values(paymentMethods);

// ================ Helpers ================

export function getPaymentMethodLabel(method: PaymentMethod, language: Language) {
  console.log(method)
  return translate(language, paymentMethods[method].label.en, paymentMethods[method].label.ar);
}

export function isCashPayment(method: PaymentMethod) {
  return method === paymentMethods.cash.value;
}

export function isWalletPayment(method: PaymentMethod) {
  return method === paymentMethods.wallet.value;
}

export function isBankTransferPayment(method: PaymentMethod) {
  return method === paymentMethods.band_transfer.value;
}

export function isInstapayPayment(method: PaymentMethod) {
  return method === paymentMethods.instapay.value;
}

export function isFawryPayment(method: PaymentMethod) {
  return method === paymentMethods.fawry.value;
}

// =============================================================

export const websitePaymentMethods: LocalizedEntity<WebsitePaymentMethod> = {
  cod: {
    value: "cod",
    label: {
      en: "Cash on Delivery",
      ar: "الدفع عند الاستلام",
    },
  },
  card: {
    value: "card",
    label: {
      en: "Credit / Debit Card",
      ar: "البطاقة البنكية",
    },
  },
  wallet: {
    value: "wallet",
    label: {
      en: "E Wallet",
      ar: "المحفظة الالكترونية",
    },
  },
};

export const websitePaymentMethodsArray = Object.values(websitePaymentMethods);

// ================ Helpers ================

export function getWebsitePaymentMethodLabel(method: WebsitePaymentMethod, language: Language) {
  return translate(language, websitePaymentMethods[method].label.en, websitePaymentMethods[method].label.ar);
}

export function isCardWebsitePayment(method: WebsitePaymentMethod) {
  return method === websitePaymentMethods.card.value;
}

export function isWalletWebsitePayment(method: WebsitePaymentMethod) {
  return method === websitePaymentMethods.wallet.value;
}

export function isCodWebsitePayment(method: WebsitePaymentMethod) {
  return method === websitePaymentMethods.cod.value;
}
