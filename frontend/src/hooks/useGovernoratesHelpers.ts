import { useGovernorates } from "@/context/GovernorateContext";
import { useLanguage } from "@/context/LanguageContext";

export default function useGovernoratesHelpers() {
  const { data: governorates } = useGovernorates();
  const { translate } = useLanguage();

  function getGovernorateById(governorateId: string) {
    return governorates.find((governorate) => governorate._id === governorateId);
  }

  function getGovernorateNameById(governorateId: string): string {
    const governorate = getGovernorateById(governorateId);
    if (!governorate) return "";
    return translate(governorate.name.en, governorate.name.ar);
  }

  return {
    getGovernorateById,
    getGovernorateNameById,
  };
}
