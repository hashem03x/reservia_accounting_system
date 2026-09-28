import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import AboutSection from "./components/about-section";

export default function Customization() {
  const { translations } = useLanguage();

  useDocumentTitle(`${translations.pages.customization} | ${translations.adminPanel}`);

  return (
    <div className="root-flex-1 flex min-h-full flex-col gap-4">
      <div className="flex flex-1 flex-col gap-4 rounded-xl bg-white p-4 shadow-md sm:p-5">
        <AboutSection />
      </div>
    </div>
  );
}
