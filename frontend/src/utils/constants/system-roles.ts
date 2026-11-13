import { SystemId } from "@/types/systems";

// Display names of each system's own roles (the vocabularies in backend/server/utils/systemsRegistry.js),
// shown in the shared app shell's footer so a user sees the role they hold in the system they are in.
const LABELS: Partial<Record<SystemId, Record<string, { en: string; ar: string }>>> = {
  CRM: {
    md: { en: "Managing Director", ar: "المدير العام" },
    admin: { en: "Admin officer", ar: "مسؤول إداري" },
    sales: { en: "Sales", ar: "المبيعات" },
    technical: { en: "Technical", ar: "فني" },
  },
  COMMERCIAL: {
    md: { en: "Managing Director", ar: "المدير العام" },
    commercial_director: { en: "Commercial Director", ar: "المدير التجاري" },
    sales: { en: "Sales", ar: "المبيعات" },
    technical: { en: "Technical", ar: "فني" },
    procurement: { en: "Procurement", ar: "المشتريات" },
    member: { en: "Member", ar: "عضو" },
  },
  HR: {
    md: { en: "Managing Director", ar: "المدير العام" },
    hr: { en: "HR officer", ar: "مسؤول الموارد البشرية" },
    manager: { en: "Line manager", ar: "مدير مباشر" },
    finance: { en: "Finance", ar: "المالية" },
  },
  WEBSITE: {
    admin: { en: "Website admin", ar: "مدير الموقع" },
    editor: { en: "Editor", ar: "محرر" },
    viewer: { en: "Viewer", ar: "مشاهد" },
  },
};

/** The label of `role` in `system`, in the current language; the raw role when unknown. */
export function systemRoleLabel(system: SystemId, role: string | null | undefined, translate: (en: string, ar: string) => string) {
  if (!role) return "";
  const l = LABELS[system]?.[role];
  return l ? translate(l.en, l.ar) : role;
}
