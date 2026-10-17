import { useEffect } from "react";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { Requisition } from "@/types/requisition";
import { Select } from "@mantine/core";

// Every NEW Purchase Invoice must reference an eligible ("open") Purchase Order (docs section
// "Link Purchase Invoices to Purchase Orders"). Fetches the full open list once (there is no
// dedicated keyword-search endpoint for Requisitions, unlike VendorSearch) and offers a searchable
// Select over it - the same "fetch once, searchable Select" pattern this codebase already uses for
// Project (see purchase-orders/new/index.tsx).
export default function RequisitionSelect({
  requisition,
  setRequisition,
}: {
  requisition: Requisition | null;
  setRequisition: (requisition: Requisition | null) => void;
}) {
  const { language, translate } = useLanguage();

  const {
    privateRequest,
    loading,
    error,
    setError,
    setLoading,
    data: requisitions,
    setData: setRequisitions,
  } = useDataHandler<Requisition[]>({ initialData: [] });

  function load() {
    handleRequest(language, setLoading, setError, async () => {
      const res = await privateRequest({ url: "requisitions", params: { status: "open", limit: 200 }, language });
      setRequisitions(res.data);
    });
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <Select
      label={translate("Purchase Order", "أمر الشراء")}
      description={translate(
        "Required - selecting a Purchase Order sets and locks its vendor and project.",
        "مطلوب - اختيار أمر الشراء يحدد ويقفل البائع والمشروع الخاصين به.",
      )}
      placeholder={
        loading
          ? translate("Loading...", "جاري التحميل...")
          : error
            ? error
            : translate("Select Purchase Order", "اختر أمر الشراء")
      }
      value={requisition?._id || null}
      onChange={(v) => setRequisition(requisitions.find((r) => r._id === v) || null)}
      data={requisitions.map((r) => ({
        value: r._id,
        label: `${r.code} - ${r.vendorId?.name || "-"} (${translate("remaining", "المتبقي")}: ${r.remainingAmount.toLocaleString()})`,
      }))}
      searchable
      clearable
      disabled={loading}
      required
      withAsterisk
      style={{ maxWidth: 420 }}
    />
  );
}
