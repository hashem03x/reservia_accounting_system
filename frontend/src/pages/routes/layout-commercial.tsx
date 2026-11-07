import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import { useUser } from "@/context/UserContext";
import paths from "@/utils/constants/paths";
import { outlineIcons, solidIcons } from "@/components/icons";
import { Button } from "@mantine/core";
import logo from "@/assets/logo_no_bg.png";

// Reservia Commercial - a lean, dedicated layout, mirroring pages/routes/layout-crm.tsx exactly
// (see that file's own header comment for why: the Commercial role vocabulary has nothing to do
// with the ERP's nav-config.ts/resource:action permission matrix). Same Mantine chrome/fonts as
// the rest of the app - only the header accent color and nav items differ from CRM's.
const NAV_ITEMS = [
  { to: `/${paths.commercial}/${paths.dashboard}`, label: { en: "Dashboard", ar: "لوحة التحكم" }, Icon: outlineIcons.Squares },
  { to: `/${paths.commercial}/${paths.commercialProjects}`, label: { en: "Projects", ar: "المشاريع" }, Icon: outlineIcons.ChartBar },
  { to: `/${paths.commercial}/${paths.commercialMaterials}`, label: { en: "Materials", ar: "قائمة الأسعار" }, Icon: outlineIcons.Users },
];

export default function CommercialLayout() {
  const { translate } = useLanguage();
  const { user } = useUser();
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <div className="flex min-h-full flex-col">
      {/* Deep navy (#123B5D) - the ERP's own primary brand color - distinguishes the Commercial
          shell from CRM's deep-green header while staying inside the shared palette (no new
          font/color introduced). */}
      <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-white sm:px-6" style={{ backgroundColor: "#123B5D" }}>
        <div className="flex items-center gap-4">
          <Link to={`/${paths.portal}`} className="flex items-center gap-2 font-semibold tracking-tight">
            <solidIcons.ArrowLeft style={{ transform: `rotateY(${translate("0", "180deg")})` }} />
            <img src={logo} alt="" aria-hidden className="h-9 w-9 rounded bg-white object-contain p-0.5" />
            <span>{translate("Reservia Commercial", "رزيرفيا - التجاري")}</span>
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
