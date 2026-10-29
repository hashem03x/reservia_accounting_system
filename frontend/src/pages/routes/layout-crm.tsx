import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import { useUser } from "@/context/UserContext";
import paths from "@/utils/constants/paths";
import { outlineIcons, solidIcons } from "@/components/icons";
import { Button } from "@mantine/core";

// Reservia CRM - a lean, dedicated layout rather than reusing the ERP's AdminLayout/nav-config.ts
// (those are wired specifically to the ERP resource:action permission matrix - see
// nav-config.ts#useAdminNavigation - which has no meaning for the CRM's own
// md/admin/sales/technical role vocabulary). Two sections only (Pipeline, Leads) does not justify
// a second collapsible-sidebar component; a simple top bar keeps this native-feeling to the
// Central Portal's Mantine look (same fonts/spacing/AdminLayoutBox cards every CRM page uses)
// without copying machinery sized for the ERP's ~20-section nav.
const NAV_ITEMS = [
  { to: `/${paths.crm}/${paths.pipeline}`, label: { en: "Pipeline", ar: "المسار" }, Icon: outlineIcons.ChartBar },
  { to: `/${paths.crm}/${paths.leads}`, label: { en: "Leads", ar: "العملاء المحتملون" }, Icon: outlineIcons.Users },
];

export default function CrmLayout() {
  const { translate } = useLanguage();
  const { user } = useUser();
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
            {translate("Reservia CRM", "نظام إدارة العملاء - رزيرفيا")}
          </Link>
          <nav className="flex items-center gap-1">
            {NAV_ITEMS.map((item) => {
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
