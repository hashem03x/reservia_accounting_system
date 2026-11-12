import { Select } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import { CRM_GOVERNORATES } from "@/types/crm";

// CRM Changes Required (12 Nov 2026), item 1 - the governorate decides the Deal Engine Rates region,
// so it is asked for at Qualified at the latest (backend utils/crm/stageRules.js GOVERNORATE_REQUIRED).
// The value stored is always the English name (backend GOVERNORATE_NAMES_EN); the label follows the
// interface language.
export default function GovernorateSelect({
  value,
  onChange,
  required = false,
  description,
  autoFocus = false,
}: {
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  description?: string;
  autoFocus?: boolean;
}) {
  const { translate } = useLanguage();
  return (
    <Select
      value={value || null}
      onChange={(v) => onChange(v || "")}
      data={CRM_GOVERNORATES.map((g) => ({ value: g.en, label: translate(g.en, g.ar) }))}
      label={translate("Governorate", "المحافظة")}
      description={description}
      required={required}
      searchable
      autoFocus={autoFocus}
      data-testid="governorate-select"
    />
  );
}
