import { Tooltip } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import { navIcons } from "@/components/icons";
import Img from "@/components/ui/img";
import logo from "@/assets/logo_no_bg.png";
import useSidebarCollapsed from "@/hooks/useSidebarCollapsed";
import SidebarNav from "../sidebar-nav";
import SidebarFooter from "../sidebar-footer";

const EXPANDED_WIDTH = 264;
const COLLAPSED_WIDTH = 68;

/**
 * The desktop / tablet admin sidebar: brand, navigation (sections, or an icon rail when collapsed)
 * and the pinned footer. Sticky to the viewport, so it never scrolls away with the page and the
 * page content takes all the remaining width.
 */
export default function AdminAside() {
  const { translations, translate } = useLanguage();
  const { nav } = translations;
  const [collapsed, setCollapsed] = useSidebarCollapsed();

  // Points toward the reading-start edge (collapse) when expanded, the other way when collapsed.
  const toggleIconClass = collapsed ? translate("rotate-180", "") : translate("", "rotate-180");

  const toggle = (
    <Tooltip
      label={collapsed ? nav.expand : nav.collapse}
      position={collapsed ? (translate("right", "left") as "right" | "left") : "bottom"}
      withArrow
      openDelay={80}
    >
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        aria-label={collapsed ? nav.expand : nav.collapse}
        aria-expanded={!collapsed}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-gray-500 outline-none transition-colors hover:bg-gray-50 hover:text-gray-800 focus-visible:ring-2 focus-visible:ring-primary-400 dark:text-[#8b97a3] dark:hover:bg-white/5 dark:hover:text-white"
      >
        <navIcons.Collapse size={16} aria-hidden className={toggleIconClass} />
      </button>
    </Tooltip>
  );

  return (
    <aside
      style={{ width: collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH }}
      className="sticky top-0 z-30 flex h-dvh shrink-0 flex-col border-e border-gray-100 bg-white transition-[width] duration-150 motion-reduce:transition-none dark:border-[#2a323c] dark:bg-[#161b22]"
      data-tour="admin-sidebar"
    >
      <header
        className={`flex h-16 shrink-0 items-center border-b border-gray-100 dark:border-[#2a323c] ${collapsed ? "justify-center" : "gap-2.5 pe-3 ps-4"}`}
      >
        <Img src={logo} alt={translations.appName} className="h-9 w-9 shrink-0 rounded-md bg-white" />
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-[14px] font-bold text-primary-700 dark:text-white">
                {translate("Reservia", "ريزيرفيا")}
              </span>
              <span className="block truncate text-[11.5px] text-gray-500">{translations.adminPanel}</span>
            </span>
            {toggle}
          </>
        )}
      </header>

      {collapsed && (
        <div className="flex shrink-0 justify-center border-b border-gray-100 py-2 dark:border-[#2a323c]">{toggle}</div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain [scrollbar-width:thin]">
        <SidebarNav collapsed={collapsed} />
      </div>

      <SidebarFooter collapsed={collapsed} />
    </aside>
  );
}
