import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import BasicInfoSection from "./components/basic-info-section";

export default function Profile() {
  const { translate } = useLanguage();

  useDocumentTitle(translate("Profile", "الملف الشخصي"));

  return (
    <div className="flex flex-col items-center gap-6 pb-12">
      <BasicInfoSection />
    </div>
  );
}
