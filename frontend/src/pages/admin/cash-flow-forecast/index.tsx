import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import ForecastView from "./_components/forecast-view";

export default function CashFlowForecast() {
  const { translations } = useLanguage();

  useDocumentTitle(`${translations.pages.cashFlowForecast} | ${translations.adminPanel}`);

  return (
    <AdminLayoutBox header={{ title: translations.pages.cashFlowForecast }}>
      <ForecastView url="cash-flow-forecast" />
    </AdminLayoutBox>
  );
}
