import { useMemo } from "react";
import { Select } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import useSectors from "@/hooks/useSectors";

/**
 * The Project Sector selector (Project create modal and Project edit form). Options are the ACTIVE
 * sectors from the backend (Admin -> Sectors) - never a hardcoded list.
 *
 * `savedValue` is the project's currently saved sector (edit form only): it is always offered, even
 * when that sector has since been deactivated or is not a managed sector, so editing a project never
 * erases or silently replaces its sector. The value itself is the sector's name (Project.sector).
 */
export default function SectorSelect({
  value,
  onChange,
  savedValue = null,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  savedValue?: string | null;
  disabled?: boolean;
}) {
  const { translate } = useLanguage();
  const { sectors, loading, error } = useSectors({ activeOnly: true });

  const data = useMemo(() => {
    const options = sectors.map((s) => ({ value: s.name, label: s.name }));
    if (savedValue && !options.some((o) => o.value === savedValue)) {
      options.push({ value: savedValue, label: `${savedValue} (${translate("inactive", "غير نشط")})` });
    }
    return options;
  }, [sectors, savedValue, translate]);

  return (
    <Select
      label={translate("Sector", "القطاع")}
      placeholder={loading ? translate("Loading sectors...", "جاري تحميل القطاعات...") : translate("Select sector (optional)", "اختر القطاع (اختياري)")}
      value={value || null}
      onChange={(v) => onChange(v || "")}
      data={data}
      error={error ? translate("Could not load sectors.", "تعذر تحميل القطاعات.") : undefined}
      disabled={disabled}
      searchable
      clearable
    />
  );
}
