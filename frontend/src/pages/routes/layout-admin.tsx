import { Outlet } from "react-router-dom";
import AdminAside from "@/components/global/navigation-admin/admin-aside";
import AdminHeader from "@/components/global/navigation-admin/admin-header";
import { useMediaQuery } from "@mantine/hooks";

export default function AdminLayout() {
  const isMobile = useMediaQuery("(max-width: 768px)"); // Breakpoint for mobile devices

  return isMobile ? (
    <div className="block h-full">
      <div className="flex min-h-full flex-col">
        <AdminHeader height="80px" />
        <div className="flex flex-1 flex-col bg-gray-50 p-4">
          <Outlet />
        </div>
      </div>
    </div>
  ) : (
    <div className="block h-full">
      <div className="flex min-h-full flex-row">
        <AdminAside />
        <div className="flex-1 overflow-hidden bg-gray-50 p-6">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
