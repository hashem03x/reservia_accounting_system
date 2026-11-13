import { useMemo } from "react";
import { useSystemAccess } from "@/context/SystemAccessContext";
import { hasWebsiteCapability, WebsiteCapability, WebsiteRole } from "@/types/website";
import { useLanguage } from "@/context/LanguageContext";
import paths from "@/utils/constants/paths";
import { outlineIcons } from "@/components/icons";
import AppShell, { NavSection } from "@/components/global/app-shell";
import { systemRoleLabel } from "@/utils/constants/system-roles";
import { ConfirmProvider } from "@/pages/website/_shared/cms";
import { Outlet } from "react-router-dom";

// Website Management - the shared app shell with the Website CMS's own navigation. `capability`
// hides an item the user's role can't open (the backend enforces the same capability on every
// request). Exit in the footer returns to the portal.
const NAV_ITEMS: { to: string; label: { en: string; ar: string }; Icon: (typeof outlineIcons)[keyof typeof outlineIcons]; capability?: WebsiteCapability }[] = [
  { to: `/${paths.website}`, label: { en: "Overview", ar: "نظرة عامة" }, Icon: outlineIcons.Squares },
  { to: `/${paths.website}/${paths.websiteVisualEditor}`, label: { en: "Visual Editor", ar: "المحرر المرئي" }, Icon: outlineIcons.Edit },
  { to: `/${paths.website}/${paths.websitePages}`, label: { en: "Pages", ar: "الصفحات" }, Icon: outlineIcons.Document },
  { to: `/${paths.website}/${paths.websiteMedia}`, label: { en: "Media", ar: "الوسائط" }, Icon: outlineIcons.Photo },
  { to: `/${paths.website}/${paths.websiteNavigation}`, label: { en: "Navigation", ar: "التنقل" }, Icon: outlineIcons.Compass },
  { to: `/${paths.website}/${paths.websiteSettings}`, label: { en: "Settings", ar: "الإعدادات" }, Icon: outlineIcons.Admin, capability: "settings.manage" },
  { to: `/${paths.website}/${paths.websiteIntegrations}`, label: { en: "Integrations", ar: "التكاملات" }, Icon: outlineIcons.Analytics, capability: "integrations.manage" },
  { to: `/${paths.website}/${paths.websiteCustomCode}`, label: { en: "Custom Code", ar: "الكود المخصص" }, Icon: outlineIcons.ShieldCheck, capability: "code.manage" },
  { to: `/${paths.website}/${paths.websiteCode}`, label: { en: "Code", ar: "الكود المصدري" }, Icon: outlineIcons.Lock, capability: "code.manage" },
  { to: `/${paths.website}/${paths.websiteActivity}`, label: { en: "Activity", ar: "النشاط" }, Icon: outlineIcons.Clock },
];

export default function WebsiteLayout() {
  const { translate } = useLanguage();
  const { systems } = useSystemAccess();
  const role = systems?.WEBSITE?.role as WebsiteRole | null | undefined;
  const sections: NavSection[] = useMemo(
    () => [
      {
        key: "website",
        title: translate("Website", "الموقع"),
        items: NAV_ITEMS.filter((item) => !item.capability || hasWebsiteCapability(role, item.capability)).map((i) => ({ key: i.to, to: i.to, label: translate(i.label.en, i.label.ar), Icon: i.Icon })),
      },
    ],
    [translate, role]
  );
  return (
    <AppShell sections={sections} subtitle={translate("Website", "الموقع الإلكتروني")} scope="website" roleLabel={systemRoleLabel("WEBSITE", role, translate)} navTestId="website-nav">
      <ConfirmProvider>
        <Outlet />
      </ConfirmProvider>
    </AppShell>
  );
}
