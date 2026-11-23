import { SystemId } from "@/types/systems";

// Display names of each system's own roles (the vocabularies in backend/server/utils/systemsRegistry.js),
// shown in the shared app shell's footer so a user sees the role they hold in the system they are in.
const LABELS: Partial<Record<SystemId, Record<string, { en: string; ar: string }>>> = {
  CRM: {
    md: { en: "Managing Director", ar: "المدير العام" },
    admin: { en: "Admin officer", ar: "مسؤول إداري" },
    sales: { en: "Sales", ar: "المبيعات" },
    technical: { en: "Technical", ar: "فني" },
    // Go-live Developer Pack section 5.2/5.5 - bdm/commercial_director/sales_viewer/marketing.
    bdm: { en: "Business Development Manager", ar: "مدير تطوير الأعمال" },
    commercial_director: { en: "Sales and Commercial Director", ar: "المدير التجاري والمبيعات" },
    sales_viewer: { en: "Sales Engineer", ar: "مهندس مبيعات" },
    marketing: { en: "Marketing Coordinator", ar: "منسق تسويق" },
  },
  COMMERCIAL: {
    md: { en: "Managing Director", ar: "المدير العام" },
    // R1 (Deal Engine Changes Required Rev 02): "use one set of names everywhere... Show the
    // label (for example 'Sales and Commercial Director') on every screen" - this used to say
    // just "Commercial Director" here, a THIRD spelling alongside Approvals' "Sales & Commercial
    // Director" and User Management's raw "commercial_director" (T7's exact finding).
    commercial_director: { en: "Sales and Commercial Director", ar: "المدير التجاري والمبيعات" },
    sales: { en: "Sales Engineer", ar: "مهندس مبيعات" },
    technical: { en: "Technical Engineer", ar: "مهندس فني" },
    procurement: { en: "Procurement", ar: "المشتريات" },
    member: { en: "Member", ar: "عضو" },
    // Go-live Developer Pack section 5.2/5.4.
    bdm: { en: "Business Development Manager", ar: "مدير تطوير الأعمال" },
    marketing: { en: "Marketing Coordinator", ar: "منسق تسويق" },
  },
  HR: {
    md: { en: "Managing Director", ar: "المدير العام" },
    hr: { en: "HR officer", ar: "مسؤول الموارد البشرية" },
    manager: { en: "Line manager", ar: "مدير مباشر" },
    finance: { en: "Finance", ar: "المالية" },
    // Go-live Developer Pack section 5.2/5.7 - employee (baseline self-service for every staff
    // member) and line_manager (approves direct reports' attendance/visits/claims/timesheets).
    employee: { en: "Employee", ar: "موظف" },
    line_manager: { en: "Line manager", ar: "مدير مباشر" },
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
