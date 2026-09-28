import { Language } from "@/types/language";
import { LocalizedEntity } from "@/types/global";
import { PaymentStatus } from "@/types/payment";
import translate from "@/utils/helpers/translate";

const paymentStatuses: LocalizedEntity<PaymentStatus> = {
  unpaid: {
    value: "unpaid",
    label: {
      en: "Unpaid",
      ar: "غير مدفوع",
    },
  },
  partial: {
    value: "partial",
    label: {
      en: "Partially Paid",
      ar: "مدفوع جزئياً",
    },
  },
  paid: {
    value: "paid",
    label: {
      en: "Paid",
      ar: "مدفوع",
    },
  },
  unknown: {
    value: "unknown",
    label: {
      en: "N/A",
      ar: "N/A",
    },
  },
};

export default paymentStatuses;

export const paymentStatusesArray = Object.values(paymentStatuses);

// ================ Helpers ================

export function getPaymentStatus(totalAmount: number, totalPaid: number): PaymentStatus {
  let status: PaymentStatus = paymentStatuses.unknown.value;
  if (totalPaid === totalAmount) {
    status = paymentStatuses.paid.value;
  } else if (totalPaid === 0) {
    status = paymentStatuses.unpaid.value;
  } else if (totalPaid > 0 && totalPaid < totalAmount) {
    status = paymentStatuses.partial.value;
  }
  return status;
}

export function getPaymentStatusLabel(status: PaymentStatus, language: Language) {
  return translate(language, paymentStatuses[status].label.en, paymentStatuses[status].label.ar);
}

export function isPaid(status: PaymentStatus) {
  return status === paymentStatuses.paid.value;
}

export function isPartiallyPaid(status: PaymentStatus) {
  return status === paymentStatuses.partial.value;
}

export function isUnpaid(status: PaymentStatus) {
  return status === paymentStatuses.unpaid.value;
}
