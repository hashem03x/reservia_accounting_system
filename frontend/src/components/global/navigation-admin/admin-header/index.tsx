import { useDisclosure } from "@mantine/hooks";
import { useLanguage } from "@/context/LanguageContext";
import { navIcons } from "@/components/icons";
import Img from "@/components/ui/img";
import logo from "@/assets/logo_no_bg.png";
import MobileDrawer from "./components/mobile-drawer";

/** The phone top bar: brand and the menu button that opens the navigation drawer. */
export default function AdminHeader({ height }: { height: string }) {
  const { translations, translate } = useLanguage();
  const [opened, { open, close }] = useDisclosure(false);

  return (
    <header
      className="sticky top-0 z-40 flex w-full items-center justify-between border-b border-gray-100 bg-white px-4 dark:border-[#2a323c] dark:bg-[#161b22]"
      style={{ height }}
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <Img src={logo} alt={translations.appName} className="h-9 w-9 shrink-0 rounded-md bg-white" />
        <span className="min-w-0 leading-tight">
          <span className="block truncate text-[14px] font-bold text-primary-700 dark:text-white">
            {translate("Reservia", "ريزيرفيا")}
          </span>
          <span className="block truncate text-[11.5px] text-gray-500">{translations.adminPanel}</span>
        </span>
      </span>

      <button
        type="button"
        onClick={open}
        aria-label={translations.nav.openMenu}
        aria-expanded={opened}
        className="flex h-10 w-10 items-center justify-center rounded-md text-gray-600 outline-none hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-primary-400 dark:text-[#a8b3bd] dark:hover:bg-white/5"
      >
        <navIcons.Menu size={22} aria-hidden />
      </button>

      <MobileDrawer opened={opened} close={close} />
    </header>
  );
}
