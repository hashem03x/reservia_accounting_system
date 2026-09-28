import { useNavigate } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import { LocalizedEntity, LocalizedLabel } from "@/types/global";
import { solidIcons } from "@/components/icons";
import { Button } from "@mantine/core";

export default function NavigationTabs<T extends string>({
  tabs,
  activeTab,
  setActiveTab,
  backAction,
  backLabel,
}: {
  tabs: LocalizedEntity<T>;
  activeTab: T;
  setActiveTab: (tab: T) => void;
  backAction?: () => void;
  backLabel?: string;
}) {
  const { translate, translations } = useLanguage();
  const navigate = useNavigate();

  if (!backAction) backAction = () => navigate(-1);
  if (!backLabel) backLabel = translations.back;

  const tabsList = Object.values(tabs);

  return (
    <header className="flex gap-2">
      <Button onClick={backAction} title={backLabel} variant="light" color="dark" radius="md" size="md" px="sm">
        <solidIcons.ArrowLeft className={`${translate("", "rotate-180")}`} />
      </Button>

      <nav
        className="grid flex-1 overflow-hidden rounded-lg bg-white shadow-md"
        style={{ gridTemplateColumns: `repeat(${tabsList.length}, minmax(0, 1fr))` }}
      >
        {tabsList.map((tab) => {
          const localizedTab = tab as LocalizedLabel<T>;
          return (
            <button
              key={localizedTab.value}
              onClick={() => setActiveTab(localizedTab.value)}
              className={`flex-center w-full gap-2 text-nowrap p-3 text-xs transition-colors sm:text-sm md:p-0 ${
                activeTab === localizedTab.value ? "bg-blue-500 text-white" : "bg-white hover:bg-gray-200"
              }`}
            >
              {translate(localizedTab.label.en, localizedTab.label.ar)}
            </button>
          );
        })}
      </nav>
    </header>
  );
}
