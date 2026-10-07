import { Language } from "@/types/language";
import { LocalizedEntity } from "@/types/global";
import { OrderSource } from "@/types/orders";
import translate from "@/utils/helpers/translate";

const orderSources: LocalizedEntity<OrderSource> = {
  cashier: {
    value: "cashier",
    label: {
      en: "Cashier",
      ar: "الكاشير",
    },
  },
  website: {
    value: "website",
    label: {
      en: "Website",
      ar: "الموقع الإلكتروني",
    },
  },
  shopify: {
    value: "shopify",
    label: {
      en: "Shopify",
      ar: "شوبيفاي",
    },
  },
};

export default orderSources;

export const orderSourcesArray = Object.values(orderSources);

// ================ Helpers ================

export function getOrderSourceLabel(source: OrderSource, language: Language) {
  return translate(language, orderSources[source].label.en, orderSources[source].label.ar);
}

export function isWebsiteOrder(source: OrderSource) {
  return source === orderSources.website.value;
}

export function isCashierOrder(method: OrderSource) {
  return method === orderSources.cashier.value;
}

export function isShopifyOrder(source: OrderSource) {
  return source === orderSources.shopify.value;
}
