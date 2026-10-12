import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { Drawer } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import { navIcons } from "@/components/icons";
import Img from "@/components/ui/img";
import logo from "@/assets/logo_no_bg.png";
import SidebarNav from "../../sidebar-nav";
import SidebarFooter from "../../sidebar-footer";

/** The phone menu: the same navigation as the sidebar, in a drawer from the reading-start side. */
export default function MobileDrawer({ opened, close }: { opened: boolean; close: () => void }) {
  const { translations, translate } = useLanguage();
  const { pathname } = useLocation();

  // Any navigation (a menu item, a link on the page, back / forward) closes the drawer.
  const firstPath = useRef(pathname);
  useEffect(() => {
    if (pathname !== firstPath.current) close();
    firstPath.current = pathname;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return (
    <Drawer
      opened={opened}
      onClose={close}
      withCloseButton={false}
      padding={0}
      size={300}
      position={translate("left", "right") as "left" | "right"}
      aria-label={translations.nav.mainNavigation}
    >
      <div className="flex h-dvh flex-col bg-white dark:bg-[#161b22]">
        <header className="flex h-16 shrink-0 items-center gap-2.5 border-b border-gray-100 pe-2 ps-4 dark:border-[#2a323c]">
          <Img src={logo} alt={translations.appName} className="h-9 w-9 shrink-0 rounded-md bg-white" />
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate text-[14px] font-bold text-primary-700 dark:text-white">
              {translate("Reservia", "ريزيرفيا")}
            </span>
            <span className="block truncate text-[11.5px] text-gray-500">{translations.adminPanel}</span>
          </span>
          <button
            type="button"
            onClick={close}
            aria-label={translations.nav.closeMenu}
            className="flex h-9 w-9 items-center justify-center rounded-md text-gray-500 outline-none hover:bg-gray-50 hover:text-gray-800 focus-visible:ring-2 focus-visible:ring-primary-400 dark:hover:bg-white/5 dark:hover:text-white"
          >
            <navIcons.Close size={20} aria-hidden />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <SidebarNav onNavigate={close} />
        </div>
        <SidebarFooter onNavigate={close} />
      </div>
    </Drawer>
  );
}
