import { Tooltip } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import { navIcons } from "@/components/icons";
import useSidebarCollapsed from "@/hooks/useSidebarCollapsed";
import { layoutTokens } from "@/theme";
import SidebarNav from "../sidebar-nav";
import SidebarFooter from "../sidebar-footer";
import ShellBrand from "../shell-brand";
import { ShellProps } from "../shell-types";

/**
 * The desktop / tablet sidebar every dashboard uses: brand, navigation (sections, or an icon rail when
 * collapsed) and the pinned footer. Sticky to the viewport, so it never scrolls away with the page and
 * the page content takes all the remaining width. Width, header height and colors are design tokens.
 */
export default function AdminAside({ sections, subtitle, scope, roleLabel, showTour, navTestId }: ShellProps) {
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
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-muted outline-none transition-colors hover:bg-surface-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-primary-400"
      >
        <navIcons.Collapse size={16} aria-hidden className={toggleIconClass} />
      </button>
    </Tooltip>
  );

  return (
    <aside
      style={{ width: collapsed ? layoutTokens.sidebarCollapsedWidth : layoutTokens.sidebarWidth }}
      className="sticky top-0 z-30 flex h-dvh shrink-0 flex-col border-e border-line bg-surface transition-[width] duration-150 motion-reduce:transition-none"
      data-tour="admin-sidebar"
    >
      <header className={`flex h-header shrink-0 items-center border-b border-line ${collapsed ? "justify-center" : "gap-2.5 pe-3 ps-4"}`}>
        {collapsed ? <ShellBrand subtitle={subtitle} className="sr-only" /> : <ShellBrand subtitle={subtitle} />}
        {!collapsed && toggle}
      </header>

      {collapsed && <div className="flex shrink-0 justify-center border-b border-line py-2">{toggle}</div>}

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain [scrollbar-width:thin]">
        <SidebarNav sections={sections} scope={scope} collapsed={collapsed} testId={navTestId} />
      </div>

      <SidebarFooter collapsed={collapsed} roleLabel={roleLabel} showTour={showTour} />
    </aside>
  );
}
