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
  // Go-live roles matrix (Developer Pack 5.2) - the server has had these since go-live; without them
  // here every page that shows such a user's role crashed ("reading 'label'").
  viewer: {
    value: "viewer",
    label: {
      en: "Viewer (read-only)",
      ar: "مشاهد (قراءة فقط)",
    },
  },
  po_drafter: {
    value: "po_drafter",
    label: {
      en: "Purchase order drafter",
      ar: "معد أوامر الشراء",
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
  return roles[role] ? translate(language, roles[role].label.en, roles[role].label.ar) : String(role ?? ""); // unknown value (e.g. added on the server later): shown as-is, never a crash
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
