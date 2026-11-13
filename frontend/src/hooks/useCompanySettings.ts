import { useEffect, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import usePrivateRequest from "@/hooks/usePrivateRequest";

// ERP company-level controls (backend services/config/companySettingsService.js). The defaults
// below are the documented ones and are used until the server answers (or if it cannot).
export type CompanySettings = { vatDefaultPct: number; priceVarianceWarnPct: number; preventNegativeProjectStock: boolean };
export const COMPANY_SETTINGS_DEFAULTS: CompanySettings = {
  vatDefaultPct: 14,
  priceVarianceWarnPct: 20,
  preventNegativeProjectStock: true,
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
