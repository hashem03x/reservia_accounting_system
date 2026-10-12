import { Outlet } from "react-router-dom";
import AdminAside from "@/components/global/navigation-admin/admin-aside";
import AdminHeader from "@/components/global/navigation-admin/admin-header";
import { useMediaQuery } from "@mantine/hooks";
import TourProvider from "@/components/global/guided-tour/tour-context";

export default function AdminLayout() {
  // Phones get a top bar with a navigation drawer; tablets and desktops the sidebar (an icon rail by
  // default on narrower screens - see useSidebarCollapsed).
  const isMobile = useMediaQuery("(max-width: 768px)", window.matchMedia("(max-width: 768px)").matches, {
    getInitialValueInEffect: false,
  });

  return (
    <TourProvider>
      {isMobile ? (
        <div className="block h-full">
          <div className="flex min-h-full flex-col">
            <AdminHeader height="64px" />
            <main className="flex min-w-0 flex-1 flex-col bg-gray-50 p-4">
              <Outlet />
            </main>
          </div>
        </div>
      ) : (
        <div className="block h-full">
          <div className="flex min-h-full flex-row">
            <AdminAside />
            <main className="min-w-0 flex-1 overflow-hidden bg-gray-50 p-6">
              <Outlet />
            </main>
          </div>
        </div>
      )}
    </TourProvider>
  );
}
