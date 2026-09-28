import { Language } from "@/types/language";
import { LocalizedEntity } from "@/types/global";
import { OrderStatus } from "@/types/orders";
import translate from "@/utils/helpers/translate";

const orderStatuses: LocalizedEntity<OrderStatus> = {
  pending: {
    value: "pending",
    label: {
      en: "Pending",
      ar: "قيد الانتظار",
    },
  },
  delivered: {
    value: "delivered",
    label: {
      en: "Delivered",
      ar: "تم التوصيل",
    },
  },
  canceled: {
    value: "canceled",
    label: {
      en: "Canceled",
      ar: "تم الإلغاء",
    },
  },
};

export default orderStatuses;

export const orderStatusesArray = Object.values(orderStatuses);

// ================ Helpers ================

export function getOrderStatusLabel(status: OrderStatus, language: Language) {
  return translate(language, orderStatuses[status].label.en, orderStatuses[status].label.ar);
}

export function isPendingOrder(status: OrderStatus) {
  return status === orderStatuses.pending.value;
}

export function isDeliveredOrder(status: OrderStatus) {
  return status === orderStatuses.delivered.value;
}

export function isCanceledOrder(status: OrderStatus) {
  return status === orderStatuses.canceled.value;
}
