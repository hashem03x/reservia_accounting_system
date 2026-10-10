import { useLanguage } from "@/context/LanguageContext";
import { ActionIcon, Tooltip } from "@mantine/core";
import { solidIcons } from "@/components/icons";
import Logo from "@/components/global/logo";
import useSidebarCollapsed from "@/hooks/useSidebarCollapsed";
import AllAdminOptions from "../all-admin-options";

const EXPANDED_WIDTH = "250px";
const COLLAPSED_WIDTH = "76px";

export default function AdminAside() {
  const { translations, translate } = useLanguage();
  const [collapsed, setCollapsed] = useSidebarCollapsed();

  const width = collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH;

  // Points "inward" (toward collapsing) when expanded, "outward" when collapsed - mirrored for RTL
  // the same way the back-button arrow in admin-layout-box.tsx is.
  const collapseIconRotation = collapsed ? translate("0deg", "180deg") : translate("180deg", "0deg");

  return (
    <aside style={{ width }}>
      <div
        style={{ width }}
        className="fixed z-10 flex h-screen flex-col overflow-y-auto border-x bg-white transition-[width] duration-150"
        data-tour="admin-sidebar"
      >
        <header className={`flex items-center border-b p-4 ${collapsed ? "justify-center" : "justify-between"}`}>
          {!collapsed && <Logo title={translations.adminPanel} />}
          {collapsed && <Logo />}
          {!collapsed && (
            <Tooltip label={translate("Collapse sidebar", "طي القائمة")} position="right" withArrow>
              <ActionIcon variant="light" color="dark" onClick={() => setCollapsed(true)}>
                <solidIcons.ArrowLeft size={16} style={{ transform: `rotate(${collapseIconRotation})` }} />
              </ActionIcon>
            </Tooltip>
          )}
        </header>

        {collapsed && (
          <div className="flex justify-center border-b py-2">
            <Tooltip label={translate("Expand sidebar", "توسيع القائمة")} position="right" withArrow>
              <ActionIcon variant="light" color="dark" onClick={() => setCollapsed(false)}>
                <solidIcons.ArrowLeft size={16} style={{ transform: `rotate(${collapseIconRotation})` }} />
              </ActionIcon>
            </Tooltip>
          </div>
        )}

        <AllAdminOptions collapsed={collapsed} />
      </div>
    </aside>
  );
}
