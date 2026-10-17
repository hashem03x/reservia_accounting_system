import { useLanguage } from "@/context/LanguageContext";
import { RequisitionEffectiveStatus } from "@/types/requisition";

export const requisitionStatusColors: Record<RequisitionEffectiveStatus, string> = {
  draft: "gray",
  open: "blue",
  partially_invoiced: "yellow",
  fully_invoiced: "green",
  cancelled: "red",
};

export function useRequisitionStatusLabel() {
  const { translate } = useLanguage();

  const labels: Record<RequisitionEffectiveStatus, string> = {
    draft: translate("Draft", "مسودة"),
    open: translate("Open", "مفتوح"),
    partially_invoiced: translate("Partially Invoiced", "مفوتر جزئياً"),
    fully_invoiced: translate("Fully Invoiced", "مفوتر بالكامل"),
    cancelled: translate("Cancelled", "ملغي"),
  };

  return (status: RequisitionEffectiveStatus) => labels[status] || status;
}
