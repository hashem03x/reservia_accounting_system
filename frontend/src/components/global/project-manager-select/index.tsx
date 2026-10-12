import { useMemo } from "react";
import { Select } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import useProjectManagers from "@/hooks/useProjectManagers";

/**
 * The Project Manager selector (Project create modal and Project edit form). Options are the ACTIVE
 * project managers from the backend (Admin -> Project Managers) - never a hardcoded list.
 *
 * `saved` is the project's current manager (edit form only): it is always offered, even when that
 * manager has since been deactivated, so editing a project never silently replaces its manager.
 */
export default function ProjectManagerSelect({
  value,
  onChange,
  saved = null,
  required,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  saved?: { _id: string; name: string } | null;
  required?: boolean;
  disabled?: boolean;
}) {
  const { translate } = useLanguage();
  const { projectManagers, loading, error } = useProjectManagers({ activeOnly: true });

  const data = useMemo(() => {
    const options = projectManagers.map((m) => ({ value: m._id, label: m.name }));
    if (saved && !options.some((o) => o.value === saved._id)) {
      options.push({ value: saved._id, label: `${saved.name} (${translate("inactive", "غير نشط")})` });
    }
    return options;
  }, [projectManagers, saved, translate]);

  return (
    <Select
      label={translate("Project Manager", "مدير المشروع")}
      placeholder={
        loading
          ? translate("Loading project managers...", "جاري تحميل مديري المشروعات...")
          : translate("Select project manager", "اختر مدير المشروع")
      }
      value={value || null}
      onChange={(v) => onChange(v || "")}
      data={data}
      error={error ? translate("Could not load project managers.", "تعذر تحميل مديري المشروعات.") : undefined}
      nothingFoundMessage={translate(
        "No project manager matches. Admins add them in Project Managers.",
        "لا يوجد مدير مطابق. يضيفهم المسؤول من صفحة مديري المشروعات.",
      )}
      disabled={disabled}
      required={required}
      searchable
    />
  );
}
