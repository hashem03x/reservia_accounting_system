import AppShell from "@/components/global/app-shell";
import { useAdminNavigation } from "@/components/global/navigation-admin/nav-config";
import TourProvider from "@/components/global/guided-tour/tour-context";
import { useLanguage } from "@/context/LanguageContext";

/** The ERP dashboard - the master design: the shared app shell with the ERP navigation and its guided tour. */
export default function AdminLayout() {
  const { translations } = useLanguage();
  const sections = useAdminNavigation();
  return (
    <TourProvider>
      <AppShell sections={sections} subtitle={translations.adminPanel} scope="erp" showTour />
    </TourProvider>
  );
}
