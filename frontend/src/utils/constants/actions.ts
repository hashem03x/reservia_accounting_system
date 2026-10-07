import { LocalizedEntity } from "@/types/global";
import { Action } from "@/types/user";

const actions: LocalizedEntity<Action> = {
  read: {
    value: "read",
    label: {
      en: "View",
      ar: "عرض",
    },
  },
  create: {
    value: "create",
    label: {
      en: "Create",
      ar: "إنشاء",
    },
  },
  update: {
    value: "update",
    label: {
      en: "Update",
      ar: "تحديث",
    },
  },
  delete: {
    value: "delete",
    label: {
      en: "Delete",
      ar: "حذف",
    },
  },
};

export default actions;

export const actionsArray = Object.values(actions);
