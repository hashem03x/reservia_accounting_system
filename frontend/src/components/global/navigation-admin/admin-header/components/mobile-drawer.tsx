import { useLanguage } from "@/context/LanguageContext";
import useWindowHeight from "@/hooks/useWindowHeight";
import { Button, Drawer } from "@mantine/core";
import { solidIcons } from "@/components/icons";
import Logo from "@/components/global/logo";
import AllAdminOptions from "../../all-admin-options";

export default function MobileDrawer({ opened, close }: { opened: boolean; close: () => void }) {
  const { translations } = useLanguage();

  // To handle the height of the drawer when the window is resized (avoiding the issue of the address bar and header taking up space on mobile browsers)
  const drawerHeight = useWindowHeight();

  return (
    <Drawer opened={opened} onClose={close} withCloseButton={false} padding={0} size="xs">
      <div className="flex flex-col" style={{ height: drawerHeight }}>
        <header className="flex items-center justify-between border-b p-4">
          <Logo title={translations.adminPanel} />
          <Button variant="subtle" color="dark" p="xs" onClick={close}>
            <solidIcons.XMark size={23.75} />
          </Button>
        </header>

        <AllAdminOptions closeDrawer={close} />
      </div>
    </Drawer>
  );
}
