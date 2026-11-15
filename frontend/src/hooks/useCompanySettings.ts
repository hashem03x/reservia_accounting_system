import { useEffect, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import { DEFAULT_VAT_TREATMENT, VatTreatmentValue } from "@/utils/constants/vat-treatment";

// ERP company-level controls (backend services/config/companySettingsService.js). The defaults
// below are the documented ones and are used until the server answers (or if it cannot).
export type CompanySettings = {
  vatDefaultPct: number;
  priceVarianceWarnPct: number;
  preventNegativeProjectStock: boolean;
  // VAT Accounting Treatment (utils/vatTreatment.js) - UI pre-fill only, mirrors vatDefaultPct's
  // own role exactly; the real, posted-from value always lives on the document itself.
  vatTreatmentDefault: VatTreatmentValue;
};
export const COMPANY_SETTINGS_DEFAULTS: CompanySettings = {
  vatDefaultPct: 14,
  priceVarianceWarnPct: 20,
  preventNegativeProjectStock: true,
  vatTreatmentDefault: DEFAULT_VAT_TREATMENT,
};

export default function useCompanySettings() {
  const { language } = useLanguage();
  const request = usePrivateRequest();
  const [settings, setSettings] = useState<CompanySettings>(COMPANY_SETTINGS_DEFAULTS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    request({ url: "company-settings", language })
      .then((res) => !cancelled && setSettings({ ...COMPANY_SETTINGS_DEFAULTS, ...(res.data as Partial<CompanySettings>) }))
      .catch(() => {})
      .finally(() => !cancelled && setLoaded(true));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { settings, loaded };
}
