import { Language } from "@/types/language";
import { LocalizedEntity } from "@/types/global";
import { PaymentMethod } from "@/types/payment";
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

// `method` is optional/nullable - a payment made via `paymentAccount` (a Chart of Accounts Cash/
// Cash-Equivalent account, see docs section "Payment Methods Must Come From Chart of Accounts")
// has no legacy `paymentMethod` string at all. Callers displaying a payment's method should prefer
// `payment.paymentAccount` (code/name) when present, falling back to this for historical payments.
export function getPaymentMethodLabel(method: PaymentMethod | null | undefined, language: Language) {
  if (!method || !paymentMethods[method]) return translate(language, "-", "-");
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

