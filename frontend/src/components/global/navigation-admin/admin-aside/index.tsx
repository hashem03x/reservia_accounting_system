import { useLanguage } from "@/context/LanguageContext";
import Logo from "@/components/global/logo";
import AllAdminOptions from "../all-admin-options";

export default function AdminAside({ width }: { width: string }) {
  const { translations } = useLanguage();

  return (
    <aside style={{ width }}>
      <div style={{ width }} className="fixed z-10 flex h-screen flex-col overflow-y-auto border-x bg-white">
        <header className="border-b p-4">
          <Logo title={translations.adminPanel} />
        </header>

        <AllAdminOptions />
      </div>
    </aside>
  );
}
