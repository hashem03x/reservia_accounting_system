import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useSystemAccess } from "@/context/SystemAccessContext";
import { hasWebsiteCapability, WebsiteCapability, WebsiteRole } from "@/types/website";
import { useLanguage } from "@/context/LanguageContext";
import { useUser } from "@/context/UserContext";
import paths from "@/utils/constants/paths";
import { outlineIcons, solidIcons } from "@/components/icons";
import { Button } from "@mantine/core";
import logo from "@/assets/logo_no_bg.png";
import { ConfirmProvider } from "@/pages/website/_shared/cms";

// Website Management - a lean, dedicated layout, mirroring pages/routes/layout-crm.tsx exactly
// (not the ERP's AdminLayout/nav-config.ts - those are wired to the ERP resource:action
// permission matrix, which has no meaning for Website Management's own admin/editor/viewer role
// vocabulary - see nav-config.ts#useAdminNavigation).
//
// Nav items are added here as each milestone ships a real page. `capability` hides an item the
// user's role can't open (the backend enforces the same capability on every request).
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
  const { user } = useUser();
  const location = useLocation();
  const navigate = useNavigate();
  const { systems } = useSystemAccess();
  const role = systems?.WEBSITE?.role as WebsiteRole | null | undefined;

  return (
    <div className="flex min-h-full flex-col">
      {/* A distinct accent from both the ERP's neutral admin header and the CRM's deep green,
          so the three shells remain visually distinguishable at a glance. */}
      <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-white sm:px-6" style={{ backgroundColor: "#0B3D91" }}>
        <div className="flex items-center gap-4">
          <Link to={`/${paths.portal}`} className="flex items-center gap-2 font-semibold tracking-tight">
            <solidIcons.ArrowLeft style={{ transform: `rotateY(${translate("0", "180deg")})` }} />
            <img src={logo} alt="" aria-hidden className="h-9 w-9 rounded bg-white object-contain p-0.5" />
            <span>{translate("Reservia Website", "موقع رزيرفيا")}</span>
          </Link>
          <nav className="flex flex-wrap items-center gap-1" data-testid="website-nav">
            {NAV_ITEMS.filter((item) => !item.capability || hasWebsiteCapability(role, item.capability)).map((item) => {
              const active = location.pathname === item.to || (item.to !== `/${paths.website}` && location.pathname.startsWith(item.to));
              return (
                <Button
                  key={item.to}
                  onClick={() => navigate(item.to)}
                  variant={active ? "white" : "subtle"}
                  color={active ? "dark" : "gray.0"}
                  size="sm"
                  leftSection={<item.Icon />}
                >
                  {translate(item.label.en, item.label.ar)}
                </Button>
              );
            })}
          </nav>
        </div>
        <span className="text-sm opacity-90">{user?.name}</span>
      </header>
      <main className="min-w-0 flex-1 bg-gray-50 p-4 sm:p-6">
        <ConfirmProvider>
          <Outlet />
        </ConfirmProvider>
      </main>
    </div>
  );
}
