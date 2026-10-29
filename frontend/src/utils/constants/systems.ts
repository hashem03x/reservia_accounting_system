import { outlineIcons } from "@/components/icons";
import paths from "@/utils/constants/paths";
import { SystemId } from "@/types/systems";

// Central Business Portal - display copy/icons/entry routes, mirroring the five system ids in
// backend/server/utils/systemsRegistry.js exactly. This file NEVER decides whether a card is
// enabled - that always comes from SystemAccessContext (GET /me/systems); this is copy only
// (docs section "Website and Future Module Architecture" - "Use configuration or a suitable
// centralized registry rather than scattering hardcoded navigation conditions").
const systems: {
  id: SystemId;
  icon: keyof typeof outlineIcons;
  name: { en: string; ar: string };
  description: { en: string; ar: string };
  entryRoute: string | null;
}[] = [
  {
    id: "ERP",
    icon: "DollarSign",
    name: { en: "ERP", ar: "نظام تخطيط الموارد" },
    description: {
      en: "Accounting, finance, procurement, projects, and enterprise operations.",
      ar: "المحاسبة، التمويل، المشتريات، المشاريع، وعمليات المؤسسة.",
    },
    entryRoute: `/${paths.admin}`,
  },
  {
    id: "HR",
    icon: "Users",
    name: { en: "HR", ar: "الموارد البشرية" },
    description: {
      en: "Employee records, attendance, leave, recruitment, and human resources workflows.",
      ar: "سجلات الموظفين، الحضور، الإجازات، التوظيف، وإجراءات الموارد البشرية.",
    },
    entryRoute: null,
  },
  {
    id: "CRM",
    icon: "Heart",
    name: { en: "CRM", ar: "إدارة علاقات العملاء" },
    description: {
      en: "Customer relationships, leads, interactions, and customer lifecycle management.",
      ar: "علاقات العملاء، العملاء المحتملين، التفاعلات، وإدارة دورة حياة العميل.",
    },
    entryRoute: `/${paths.crm}`,
  },
  {
    id: "COMMERCIAL",
    icon: "ShoppingBag",
    name: { en: "Commercial", ar: "التجاري" },
    description: {
      en: "Commercial activities, sales operations, proposals, and business development workflows.",
      ar: "الأنشطة التجارية، عمليات المبيعات، العروض، وتطوير الأعمال.",
    },
    entryRoute: null,
  },
  {
    id: "WEBSITE",
    icon: "Globe",
    name: { en: "Website", ar: "الموقع الإلكتروني" },
    description: {
      en: "Access to the company website's content management dashboard.",
      ar: "الوصول إلى لوحة إدارة محتوى الموقع الإلكتروني للشركة.",
    },
    entryRoute: null,
  },
];

export default systems;

// The real, public, unauthenticated Reservia website - always reachable regardless of membership
// (docs section "Website and Future Module Architecture" - "The central portal must not become a
// mandatory login page for ordinary public website visitors"). Set via env so each deployment can
// point at its own real URL without a code change.
export const PUBLIC_WEBSITE_URL = import.meta.env.VITE_PUBLIC_WEBSITE_URL || "";
