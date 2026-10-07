import { useDisclosure } from "@mantine/hooks";
import { useLanguage } from "@/context/LanguageContext";
import { Button } from "@mantine/core";
import { solidIcons } from "@/components/icons";
import Logo from "@/components/global/logo";
import MobileDrawer from "./components/mobile-drawer";

export default function AdminHeader({ height }: { height: string }) {
  const { translations } = useLanguage();
  const [opened, { open, close }] = useDisclosure(false);

  return (
    <header className="sticky top-0 z-40 flex w-full items-center justify-between bg-white px-4 shadow" style={{ height }}>
      <Logo title={translations.adminPanel} />

      <Button variant="light" color="dark" p="xs" onClick={open}>
        <solidIcons.Bars3 size={23.75} />
      </Button>

      <MobileDrawer opened={opened} close={close} />
    </header>
  );
}
