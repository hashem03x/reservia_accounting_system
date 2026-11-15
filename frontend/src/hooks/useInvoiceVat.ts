import { useEffect, useRef, useState } from "react";
import useCompanySettings from "@/hooks/useCompanySettings";
import { VatTreatmentValue } from "@/utils/constants/vat-treatment";

/**
 * ERP CHG-06 - the VAT state of a new sales or purchase invoice. It starts from the company VAT
 * rate (Company settings, 14% by default) instead of 0%; "no VAT" stays possible but needs a reason,
 * which the server checks as well (backend utils/validators/taxValidators.js).
 *
 * Also carries the VAT Accounting Treatment (utils/vatTreatment.js) - purchase-side only (Purchase
 * Invoices, Expenses, Fixed Assets). A Sales Order never reads `vatTreatment`/`vatPayload`'s lack
 * of it; its own "No VAT" is expressed entirely through `vatPercentage`/`vatExemptReason` above.
 */
export default function useInvoiceVat() {
  const { settings, loaded } = useCompanySettings();
  const [vatPercentage, setVatPercentageState] = useState<string | number>(settings.vatDefaultPct);
  const [vatExemptReason, setVatExemptReason] = useState("");
  const [vatTreatment, setVatTreatmentState] = useState<VatTreatmentValue>(settings.vatTreatmentDefault);
  const touched = useRef(false);
  const treatmentTouched = useRef(false);

  // The company rate arrives after the first render; apply it unless the user already chose a rate.
  useEffect(() => {
    if (loaded && !touched.current) setVatPercentageState(settings.vatDefaultPct);
  }, [loaded, settings.vatDefaultPct]);

  useEffect(() => {
    if (loaded && !treatmentTouched.current) setVatTreatmentState(settings.vatTreatmentDefault);
  }, [loaded, settings.vatTreatmentDefault]);

  const setVatPercentage = (value: string | number) => {
    touched.current = true;
    setVatPercentageState(value);
  };

  const setVatTreatment = (value: VatTreatmentValue) => {
    treatmentTouched.current = true;
    setVatTreatmentState(value);
  };

  const isZero = vatPercentage === "" || Number(vatPercentage) === 0;
  /**
   * The payload fields: always an explicit rate, and the reason when it is 0%. Deliberately never
   * includes `vatTreatment` - a Sales Order has no such field (Decision: "No VAT" on sales is
   * fully expressed by vatPercentage/vatExemptReason above); a purchase-side form that DOES need
   * it reads the separate `vatTreatment` value below and adds it to its own request body itself.
   */
  const vatPayload = () => ({
    vatPercentage: Number(vatPercentage) || 0,
    ...(isZero ? { vatExemptReason: vatExemptReason.trim() } : {}),
  });
  const reasonMissing = isZero && vatExemptReason.trim().length < 3;

  return {
    vatPercentage,
    setVatPercentage,
    vatExemptReason,
    setVatExemptReason,
    vatTreatment,
    setVatTreatment,
    isZero,
    reasonMissing,
    vatPayload,
    defaultVat: settings.vatDefaultPct,
  };
}
