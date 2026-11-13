import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { Drawer } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import { navIcons } from "@/components/icons";
import SidebarNav from "../../sidebar-nav";
import SidebarFooter from "../../sidebar-footer";
import ShellBrand from "../../shell-brand";
import { ShellProps } from "../../shell-types";

/** The phone menu of every dashboard: the same navigation as the sidebar, in a drawer from the reading-start side. */
export default function MobileDrawer({ opened, close, sections, subtitle, scope, roleLabel, showTour, navTestId }: ShellProps & { opened: boolean; close: () => void }) {
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
      <div className="flex h-dvh flex-col bg-surface">
        <header className="flex h-header shrink-0 items-center gap-2.5 border-b border-line pe-2 ps-4">
          <ShellBrand subtitle={subtitle} />
          <button
            type="button"
            onClick={close}
            aria-label={translations.nav.closeMenu}
            className="flex h-9 w-9 items-center justify-center rounded-md text-ink-muted outline-none hover:bg-surface-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-primary-400"
          >
            <navIcons.Close size={20} aria-hidden />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <SidebarNav sections={sections} scope={scope} onNavigate={close} testId={navTestId} />
        </div>
        <SidebarFooter onNavigate={close} roleLabel={roleLabel} showTour={showTour} />
      </div>
    </Drawer>
  );
}
