import { useMemo } from "react";
import { useLanguage } from "@/context/LanguageContext";
import { useSystemAccess } from "@/context/SystemAccessContext";
import paths from "@/utils/constants/paths";
import { outlineIcons } from "@/components/icons";
import AppShell, { NavSection } from "@/components/global/app-shell";
import { systemRoleLabel } from "@/utils/constants/system-roles";

// Reservia Deal Engine (system id COMMERCIAL) - the shared app shell with the Deal Engine's own
// navigation (same items and order as before). Exit in the footer returns to the portal.
const NAV_ITEMS = [
  { key: "de-dashboard", to: `/${paths.commercial}/${paths.dashboard}`, label: { en: "Dashboard", ar: "لوحة التحكم" }, Icon: outlineIcons.Squares },
  { key: "de-projects", to: `/${paths.commercial}/${paths.commercialProjects}`, label: { en: "Projects", ar: "المشاريع" }, Icon: outlineIcons.ChartBar },
  { key: "de-materials", to: `/${paths.commercial}/${paths.commercialMaterials}`, label: { en: "Materials", ar: "قائمة الأسعار" }, Icon: outlineIcons.Users },
  { key: "de-suppliers", to: `/${paths.commercial}/${paths.commercialSuppliers}`, label: { en: "Suppliers", ar: "الموردون" }, Icon: outlineIcons.Users },
  { key: "de-pricing", to: `/${paths.commercial}/${paths.commercialPricingConfig}`, label: { en: "Pricing Config", ar: "إعدادات التسعير" }, Icon: outlineIcons.Squares },
];

export default function CommercialLayout() {
  const { translate } = useLanguage();
  const { systems } = useSystemAccess();
  const role = systems?.COMMERCIAL?.role || "";
  const sections: NavSection[] = useMemo(
    () => [{ key: "deal-engine", title: translate("Deal Engine", "محرك الصفقات"), items: NAV_ITEMS.map((i) => ({ key: i.key, to: i.to, label: translate(i.label.en, i.label.ar), Icon: i.Icon })) }],
    [translate]
  );
  return <AppShell sections={sections} subtitle={translate("Deal Engine", "محرك الصفقات")} scope="deal-engine" roleLabel={systemRoleLabel("COMMERCIAL", role, translate)} navTestId="deal-engine-nav" />;
}
