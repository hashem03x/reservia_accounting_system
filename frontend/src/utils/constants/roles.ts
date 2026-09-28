import { Language } from "@/types/language";
import { LocalizedEntity } from "@/types/global";
import { Role } from "@/types/user";
import translate from "@/utils/helpers/translate";

const roles: LocalizedEntity<Role> = {
  admin: {
    value: "admin",
    label: {
      en: "Admin",
      ar: "مسؤول",
    },
  },
  moderator: {
    value: "moderator",
    label: {
      en: "Moderator",
      ar: "مشرف",
    },
  },
  operator: {
    value: "operator",
    label: {
      en: "Representative",
      ar: "مندوب",
    },
  },
  user: {
    value: "user",
    label: {
      en: "Customer",
      ar: "عميل",
    },
  },
};

export default roles;

export const rolesArray = Object.values(roles);

// ================ Helpers ================

export const getRoleLabel = (role: Role, language: Language) => {
  return translate(language, roles[role].label.en, roles[role].label.ar);
};

export function isAdmin(role: Role) {
  return role === roles.admin.value;
}

export function isModerator(role: Role) {
  return role === roles.moderator.value;
}

export function isRepresentative(role: Role) {
  return role === roles.operator.value;
}

export function isCustomer(role: Role) {
  return role === roles.user.value;
}
