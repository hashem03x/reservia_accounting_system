import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import { useUser } from "@/context/UserContext";
import { useSystemAccess } from "@/context/SystemAccessContext";
import paths from "@/utils/constants/paths";
import { outlineIcons, solidIcons } from "@/components/icons";
import { Button } from "@mantine/core";
import logo from "@/assets/logo_no_bg.png";

// Reservia CRM - a lean, dedicated layout rather than reusing the ERP's AdminLayout/nav-config.ts
// (those are wired specifically to the ERP resource:action permission matrix - see
// nav-config.ts#useAdminNavigation - which has no meaning for the CRM's own
// md/admin/sales/technical role vocabulary). A simple top bar keeps this native-feeling to the
// Central Portal's Mantine look (same fonts/spacing/AdminLayoutBox cards every CRM page uses)
// without copying machinery sized for the ERP's ~20-section nav.
//
// Dashboard is listed FIRST (acceptance report section 4: "Add a Dashboard as the first menu item
// and the screen users land on after login") and / (pipeline's current default) now redirects
// there - see routes/index.tsx's own CRM route block.
// CSV import is deliberately NOT a nav item/separate page - every other list page in this ERP
// (products, vendors, customers, purchase orders, sales orders) offers it as an inline
// "Import CSV" button + ImportWizardModal on the list page itself (see leads/index.tsx); a
// standalone menu entry would be the one inconsistent import flow in the whole app.
const NAV_ITEMS = [
  { to: `/${paths.crm}/${paths.dashboard}`, label: { en: "Dashboard", ar: "لوحة التحكم" }, Icon: outlineIcons.Squares },
  { to: `/${paths.crm}/${paths.pipeline}`, label: { en: "Pipeline", ar: "المسار" }, Icon: outlineIcons.ChartBar },
  { to: `/${paths.crm}/${paths.leads}`, label: { en: "Leads", ar: "العملاء المحتملون" }, Icon: outlineIcons.Users },
  { to: `/${paths.crm}/${paths.performance}`, label: { en: "Performance", ar: "الأداء" }, Icon: outlineIcons.ChartBar },
  // Change Request 2, section 4 - visible to the roles the API allows (MD/Admin); hiding it from
  // others is a convenience, the route and API enforce the same rule.
  { to: `/${paths.crm}/${paths.integrations}`, label: { en: "Integrations", ar: "التكاملات" }, Icon: outlineIcons.Globe, roles: ["md", "admin"] },
];

export default function CrmLayout() {
  const { translate } = useLanguage();
  const { user } = useUser();
  const { systems } = useSystemAccess();
  const crmRole = systems?.CRM?.role || "";
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <div className="flex min-h-full flex-col">
      {/* Deep green (#004F2F) - the Reservia brand accent - distinguishes the CRM shell from the
          ERP's neutral admin header at a glance, without departing from the shared Mantine chrome. */}
      <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-white sm:px-6" style={{ backgroundColor: "#004F2F" }}>
        <div className="flex items-center gap-4">
          <Link to={`/${paths.portal}`} className="flex items-center gap-2 font-semibold tracking-tight">
            <solidIcons.ArrowLeft style={{ transform: `rotateY(${translate("0", "180deg")})` }} />
            {/* The official Reservia logo (acceptance report finding 5) - object-contain, never
                cropped, so the full mark + "Reserv-i-a" wordmark (the battery-shaped "i") shows
                exactly as designed, at any height. */}
            <img src={logo} alt="" aria-hidden className="h-9 w-9 rounded bg-white object-contain p-0.5" />
            <span>{translate("Reservia CRM", "نظام إدارة العملاء - رزيرفيا")}</span>
          </Link>
          <nav className="flex flex-wrap items-center gap-1">
            {NAV_ITEMS.filter((item) => !item.roles || item.roles.includes(crmRole)).map((item) => {
              const active = location.pathname.startsWith(item.to);
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
        <Outlet />
      </main>
    </div>
  );
}
