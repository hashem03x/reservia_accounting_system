import { useMemo } from "react";
import { useLanguage } from "@/context/LanguageContext";
import { useSystemAccess } from "@/context/SystemAccessContext";
import paths from "@/utils/constants/paths";
import { outlineIcons } from "@/components/icons";
import AppShell, { NavSection } from "@/components/global/app-shell";
import { systemRoleLabel } from "@/utils/constants/system-roles";
import { CommercialRole } from "@/types/commercial";
import { canView, enginePageAccess } from "../commercial/_shared/dealEnginePermissions";

// Reservia Deal Engine (system id COMMERCIAL) - the shared app shell with the Deal Engine's own
// navigation (same items and order as before). Exit in the footer returns to the portal.
// Materials/Suppliers carry their own ENGINE_PAGE_MATRIX row (Marketing is 'hidden' on both,
// everyone else at least 'view') - `page` ties a nav item to that row; items with no `page` (the
// Dashboard, Projects list, and the pricing-config page, which uses its own separate "any active
// membership" read gate) are open to every Commercial role, unfiltered, as before.
const NAV_ITEMS: { key: string; to: string; label: { en: string; ar: string }; Icon: (typeof outlineIcons)[keyof typeof outlineIcons]; page?: "materials" | "suppliers" }[] = [
  { key: "de-dashboard", to: `/${paths.commercial}/${paths.dashboard}`, label: { en: "Dashboard", ar: "لوحة التحكم" }, Icon: outlineIcons.Squares },
  { key: "de-projects", to: `/${paths.commercial}/${paths.commercialProjects}`, label: { en: "Projects", ar: "المشاريع" }, Icon: outlineIcons.ChartBar },
  { key: "de-materials", to: `/${paths.commercial}/${paths.commercialMaterials}`, label: { en: "Materials", ar: "قائمة الأسعار" }, Icon: outlineIcons.Users, page: "materials" },
  { key: "de-suppliers", to: `/${paths.commercial}/${paths.commercialSuppliers}`, label: { en: "Suppliers", ar: "الموردون" }, Icon: outlineIcons.Users, page: "suppliers" },
  { key: "de-pricing", to: `/${paths.commercial}/${paths.commercialPricingConfig}`, label: { en: "Pricing Config", ar: "إعدادات التسعير" }, Icon: outlineIcons.Squares },
];

export default function CommercialLayout() {
  const { translate } = useLanguage();
  const { systems } = useSystemAccess();
  const role = (systems?.COMMERCIAL?.role || "") as CommercialRole | "";
  const roles = role ? [role as CommercialRole] : [];
  const visible = NAV_ITEMS.filter((i) => !i.page || canView(enginePageAccess(roles, i.page)));
  const sections: NavSection[] = useMemo(
    () => [{ key: "deal-engine", title: translate("Deal Engine", "محرك الصفقات"), items: visible.map((i) => ({ key: i.key, to: i.to, label: translate(i.label.en, i.label.ar), Icon: i.Icon })) }],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [translate, role]
  );
  return <AppShell sections={sections} subtitle={translate("Deal Engine", "محرك الصفقات")} scope="deal-engine" roleLabel={systemRoleLabel("COMMERCIAL", role, translate)} navTestId="deal-engine-nav" />;
}
