import { useEffect, useMemo } from "react";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { Requisition } from "@/types/requisition";
import { Alert, Button, Select } from "@mantine/core";
import { outlineIcons } from "@/components/icons";

// Every NEW Purchase Invoice must reference an eligible ("open") Purchase Order (docs section
// "Link Purchase Invoices to Purchase Orders"). Fetches the full open list once (there is no
// dedicated keyword-search endpoint for Requisitions, unlike VendorSearch) and offers a searchable
// Select over it - the same "fetch once, searchable Select" pattern this codebase already uses for
// Project (see purchase-orders/new/index.tsx).
//
// Filters client-side to `remainingAmount > 0` on top of the server's own `status=open` filter: a
// Purchase Order's stored `status` never automatically transitions once fully invoiced (only the
// derived `effectiveStatus` becomes 'fully_invoiced' - see requisitionModel.js's toJSON transform),
// so a server-side `status=open` match alone can still include a depleted Purchase Order with
// nothing left to invoice against. Offering that one here would let the invoice's own atomic
// amount guard (purchaseOrder.js's pre('save')) reject the submission later with a confusing error
// instead of simply not being offered in the first place.
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
      setRequisitions(res.data || []);
    });
  }

  useEffect(() => {
    load();
  }, []);

  // Only Purchase Orders that still have something left to invoice against (see the file-level
  // comment above) - never offer one the backend would reject anyway.
  const eligibleRequisitions = useMemo(() => requisitions.filter((r) => r.remainingAmount > 0), [requisitions]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-end gap-2">
        <Select
          label={translate("Purchase Order", "أمر الشراء")}
          description={translate(
            "Required - selecting a Purchase Order sets and locks its vendor and project.",
            "مطلوب - اختيار أمر الشراء يحدد ويقفل البائع والمشروع الخاصين به.",
          )}
          placeholder={
            loading
              ? translate("Loading Purchase Orders...", "جاري تحميل أوامر الشراء...")
              : error
                ? translate("Failed to load Purchase Orders", "فشل تحميل أوامر الشراء")
                : eligibleRequisitions.length === 0
                  ? translate("No open Purchase Orders available", "لا توجد أوامر شراء مفتوحة متاحة")
                  : translate("Select Purchase Order", "اختر أمر الشراء")
          }
          value={requisition?._id || null}
          onChange={(v) => setRequisition(eligibleRequisitions.find((r) => r._id === v) || null)}
          data={eligibleRequisitions.map((r) => ({
            value: r._id,
            label: `${r.code} - ${r.vendorId?.name || "-"} (${translate("remaining", "المتبقي")}: ${r.remainingAmount.toLocaleString()})`,
          }))}
          searchable
          clearable
          disabled={loading || !!error}
          required
          withAsterisk
          style={{ maxWidth: 420, flex: 1 }}
        />
      </div>

      {/* A failed request must never look like "there just aren't any" (same empty dropdown
          either way) - a visible, actionable error with its own retry. */}
      {error && (
        <Alert
          color="red"
          variant="light"
          icon={<outlineIcons.ExclamationCircle />}
          title={translate("Could not load Purchase Orders", "تعذر تحميل أوامر الشراء")}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>{error}</span>
            <Button size="xs" variant="light" color="red" onClick={load}>
              {translate("Retry", "إعادة المحاولة")}
            </Button>
          </div>
        </Alert>
      )}

      {!loading && !error && eligibleRequisitions.length === 0 && (
        <p className="text-xs text-gray-500">
          {translate(
            "No open Purchase Orders are available for invoicing yet. Create one from the Purchase Orders section and click \"Open\" on it first.",
            "لا توجد أوامر شراء مفتوحة متاحة للفوترة حالياً. أنشئ أمر شراء من قسم أوامر الشراء ثم اضغط \"فتح\" عليه أولاً.",
          )}
        </p>
      )}
    </div>
  );
}
