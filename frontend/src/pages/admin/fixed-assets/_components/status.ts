import { useLanguage } from "@/context/LanguageContext";
import { FixedAssetStatus } from "@/types/fixed-asset";

export const fixedAssetStatusColors: Record<FixedAssetStatus, string> = {
  active: "green",
  fully_depreciated: "gray",
  under_maintenance: "yellow",
  disposed: "red",
};

export function useFixedAssetStatusLabel() {
  const { translate } = useLanguage();
  return (status: FixedAssetStatus) =>
    ({
      active: translate("Active", "نشط"),
      fully_depreciated: translate("Fully Depreciated", "مهلك بالكامل"),
      under_maintenance: translate("Under Maintenance", "تحت الصيانة"),
      disposed: translate("Disposed", "مستبعد"),
    })[status];
}
