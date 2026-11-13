import { useMemo } from "react";
import { useLanguage } from "@/context/LanguageContext";
import { useSystemAccess } from "@/context/SystemAccessContext";
import paths from "@/utils/constants/paths";
import { outlineIcons } from "@/components/icons";
import AppShell, { NavSection } from "@/components/global/app-shell";
import { systemRoleLabel } from "@/utils/constants/system-roles";

// Reservia CRM - the shared app shell (the ERP's sidebar, phone header and drawer) with the CRM's own
// navigation. Items, order and the role filter are the CRM's: Dashboard first (acceptance report
// section 4), Integrations for MD/Admin only (Change Request 2, section 4 - the route and the API
// enforce the same rule). CSV import stays an inline button on the Leads page, like every other ERP
// list. Exit in the footer returns to the portal.
const NAV_ITEMS = [
  { key: "crm-dashboard", to: `/${paths.crm}/${paths.dashboard}`, label: { en: "Dashboard", ar: "لوحة التحكم" }, Icon: outlineIcons.Squares },
  { key: "crm-pipeline", to: `/${paths.crm}/${paths.pipeline}`, label: { en: "Pipeline", ar: "المسار" }, Icon: outlineIcons.ChartBar },
  { key: "crm-leads", to: `/${paths.crm}/${paths.leads}`, label: { en: "Leads", ar: "العملاء المحتملون" }, Icon: outlineIcons.Users },
  { key: "crm-performance", to: `/${paths.crm}/${paths.performance}`, label: { en: "Performance", ar: "الأداء" }, Icon: outlineIcons.ChartBar },
  { key: "crm-integrations", to: `/${paths.crm}/${paths.integrations}`, label: { en: "Integrations", ar: "التكاملات" }, Icon: outlineIcons.Globe, roles: ["md", "admin"] },
];

export default function CrmLayout() {
  const { translate } = useLanguage();
  const { systems } = useSystemAccess();
  const crmRole = systems?.CRM?.role || "";
  const sections: NavSection[] = useMemo(
    () => [
      {
        key: "crm",
        title: translate("CRM", "إدارة العملاء"),
        items: NAV_ITEMS.filter((i) => !i.roles || i.roles.includes(crmRole)).map((i) => ({ key: i.key, to: i.to, label: translate(i.label.en, i.label.ar), Icon: i.Icon })),
      },
    ],
    [translate, crmRole]
  );
  return <AppShell sections={sections} subtitle={translate("CRM", "نظام إدارة العملاء")} scope="crm" roleLabel={systemRoleLabel("CRM", crmRole, translate)} navTestId="crm-nav" />;
}
