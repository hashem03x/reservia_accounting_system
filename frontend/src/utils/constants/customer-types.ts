import { Language } from "@/types/language";
import { LocalizedEntity } from "@/types/global";
import { CustomerType } from "@/types/customer";
import translate from "@/utils/helpers/translate";

const customerTypes: LocalizedEntity<CustomerType> = {
  online: {
    value: "online",
    label: {
      en: "Online Customer",
      ar: "عميل عبر الإنترنت",
    },
  },
  offline: {
    value: "offline",
    label: {
      en: "Offline Customer",
      ar: "عميل مباشر",
    },
  },
};

export default customerTypes;

export const customerTypesArray = Object.values(customerTypes);

// ================ Helpers ================

export const getCustomerTypeLabel = (customerType: CustomerType, language: Language) => {
  return translate(language, customerTypes[customerType].label.en, customerTypes[customerType].label.ar);
};

export function isOnline(customerType: CustomerType) {
  return customerType === customerTypes.online.value;
}

export function isOffline(customerType: CustomerType) {
  return customerType === customerTypes.offline.value;
}
