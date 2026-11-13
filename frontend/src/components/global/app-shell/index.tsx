import { ReactNode } from "react";
import { Outlet } from "react-router-dom";
import { useMediaQuery } from "@mantine/hooks";
import AdminAside from "@/components/global/navigation-admin/admin-aside";
import AdminHeader from "@/components/global/navigation-admin/admin-header";
import { ShellProps } from "@/components/global/navigation-admin/shell-types";

export type { ShellProps } from "@/components/global/navigation-admin/shell-types";
export type { NavItem, NavSection } from "@/components/global/navigation-admin/nav-config";

/**
 * The Reservia app shell - the ERP dashboard's layout, shared by every dashboard (ERP, CRM, Deal
 * Engine, HR, Website). Tablets and desktops get the sidebar (collapsible to an icon rail, remembered
 * per device); phones get the top bar with the navigation drawer. Each dashboard passes only its own
 * navigation and labels; sizes, colors and behaviour come from the design system
 * (src/theme/tokens.json). Renders the route's <Outlet /> unless children are given.
 */
export default function AppShell({ children, ...shell }: ShellProps & { children?: ReactNode }) {
  const isMobile = useMediaQuery("(max-width: 768px)", window.matchMedia("(max-width: 768px)").matches, {
    getInitialValueInEffect: false,
  });
  const content = children ?? <Outlet />;

  return isMobile ? (
    <div className="block h-full">
      <div className="flex min-h-full flex-col">
        <AdminHeader {...shell} />
        <main className="flex min-w-0 flex-1 flex-col bg-page p-4">{content}</main>
      </div>
    </div>
  ) : (
    <div className="block h-full">
      <div className="flex min-h-full flex-row">
        <AdminAside {...shell} />
        <main className="min-w-0 flex-1 overflow-hidden bg-page p-6">{content}</main>
      </div>
    </div>
  );
}
