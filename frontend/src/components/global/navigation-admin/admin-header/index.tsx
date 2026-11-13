import { useDisclosure } from "@mantine/hooks";
import { useLanguage } from "@/context/LanguageContext";
import { navIcons } from "@/components/icons";
import ShellBrand from "../shell-brand";
import { ShellProps } from "../shell-types";
import MobileDrawer from "./components/mobile-drawer";

/** The phone top bar every dashboard uses: brand and the menu button that opens the navigation drawer. */
export default function AdminHeader(props: ShellProps) {
  const { translations } = useLanguage();
  const [opened, { open, close }] = useDisclosure(false);

  return (
    <header className="sticky top-0 z-40 flex h-header w-full items-center justify-between border-b border-line bg-surface px-4">
      <span className="flex min-w-0 items-center gap-2.5">
        <ShellBrand subtitle={props.subtitle} />
      </span>

      <button
        type="button"
        onClick={open}
        aria-label={translations.nav.openMenu}
        aria-expanded={opened}
        className="flex h-10 w-10 items-center justify-center rounded-md text-ink-secondary outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-primary-400"
      >
        <navIcons.Menu size={22} aria-hidden />
      </button>

      <MobileDrawer opened={opened} close={close} {...props} />
    </header>
  );
}
