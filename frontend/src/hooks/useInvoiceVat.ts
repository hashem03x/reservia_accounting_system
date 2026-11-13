import { useEffect, useRef, useState } from "react";
import useCompanySettings from "@/hooks/useCompanySettings";

/**
 * ERP CHG-06 - the VAT state of a new sales or purchase invoice. It starts from the company VAT
 * rate (Company settings, 14% by default) instead of 0%; "no VAT" stays possible but needs a reason,
 * which the server checks as well (backend utils/validators/taxValidators.js).
 */
export default function useInvoiceVat() {
  const { settings, loaded } = useCompanySettings();
  const [vatPercentage, setVatPercentageState] = useState<string | number>(settings.vatDefaultPct);
  const [vatExemptReason, setVatExemptReason] = useState("");
  const touched = useRef(false);

  // The company rate arrives after the first render; apply it unless the user already chose a rate.
  useEffect(() => {
    if (loaded && !touched.current) setVatPercentageState(settings.vatDefaultPct);
  }, [loaded, settings.vatDefaultPct]);

  const setVatPercentage = (value: string | number) => {
    touched.current = true;
    setVatPercentageState(value);
  };

  const isZero = vatPercentage === "" || Number(vatPercentage) === 0;
  /** The payload fields: always an explicit rate, and the reason when it is 0%. */
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
    isZero,
    reasonMissing,
    vatPayload,
    defaultVat: settings.vatDefaultPct,
  };
}
