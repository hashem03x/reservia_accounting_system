import { IconType } from "react-icons";
import { useNavigate } from "react-router-dom";
import { Tooltip, useMantineColorScheme } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import { useUser } from "@/context/UserContext";
import { useTour } from "@/components/global/guided-tour/tour-context";
import { navIcons } from "@/components/icons";
import { getRoleLabel } from "@/utils/constants/roles";

// Cycles Light -> Dark -> System -> Light (the app's existing color scheme preference).
const NEXT_COLOR_SCHEME = { light: "dark", dark: "auto", auto: "light" } as const;
const COLOR_SCHEME_ICON = { light: navIcons.Light, dark: navIcons.Dark, auto: navIcons.System };

function FooterAction({
  Icon,
  label,
  onClick,
  dataTour,
  mirror = false,
}: {
  Icon: IconType;
  label: string;
  onClick: () => void;
  dataTour?: string;
  mirror?: boolean;
}) {
  const { translate } = useLanguage();
  return (
    <Tooltip label={label} position="top" withArrow openDelay={80}>
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        data-tour={dataTour}
        className="flex h-9 w-9 items-center justify-center rounded-md text-gray-500 outline-none transition-colors duration-100 hover:bg-gray-50 hover:text-gray-800 focus-visible:ring-2 focus-visible:ring-primary-400 motion-reduce:transition-none dark:text-[#8b97a3] dark:hover:bg-white/5 dark:hover:text-white"
      >
        <Icon size={18} aria-hidden className={mirror ? translate("", "-scale-x-100") : ""} />
      </button>
    </Tooltip>
  );
}

/** Signed-in user and the app preferences (tour, theme, language) plus Exit, pinned under the menu. */
export default function SidebarFooter({ collapsed = false, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const { translate, translations, toggleLanguage, language } = useLanguage();
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const { user } = useUser();
  const { start: startTour } = useTour();
  const navigate = useNavigate();
  const { nav } = translations;

  const themeLabel = translate(
    { light: "Light theme (switch)", dark: "Dark theme (switch)", auto: "System theme (switch)" }[colorScheme],
    { light: "المظهر الفاتح (تبديل)", dark: "المظهر الداكن (تبديل)", auto: "مظهر النظام (تبديل)" }[colorScheme],
  );

  const actions = (
    <>
      <FooterAction
        Icon={navIcons.Tour}
        label={nav.tour}
        dataTour="make-a-tour"
        onClick={() => {
          onNavigate?.();
          startTour();
        }}
      />
      <FooterAction
        Icon={COLOR_SCHEME_ICON[colorScheme]}
        label={themeLabel}
        onClick={() => setColorScheme(NEXT_COLOR_SCHEME[colorScheme])}
      />
      <FooterAction Icon={navIcons.Language} label={nav.switchLanguage} onClick={toggleLanguage} />
      <FooterAction
        Icon={navIcons.Exit}
        label={translations.exit}
        mirror
        onClick={() => {
          onNavigate?.();
          navigate("/");
        }}
      />
    </>
  );

  return (
    <footer className="shrink-0 border-t border-gray-100 bg-white px-2 py-2 dark:border-[#2a323c] dark:bg-[#161b22]">
      {!collapsed && user && (
        <div className="flex items-center gap-2.5 px-2 pb-2 pt-1">
          <span
            aria-hidden
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-600 text-[13px] font-semibold text-white"
          >
            {user.name?.trim().charAt(0).toLocaleUpperCase() || "?"}
          </span>
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate text-[13px] font-medium text-gray-800 dark:text-[#e6e9ec]">{user.name}</span>
            <span className="block truncate text-[11.5px] text-gray-500">{getRoleLabel(user.role, language)}</span>
          </span>
        </div>
      )}
      <div className={collapsed ? "flex flex-col items-center gap-1" : "flex items-center justify-between px-1"}>
        {actions}
      </div>
    </footer>
  );
}
