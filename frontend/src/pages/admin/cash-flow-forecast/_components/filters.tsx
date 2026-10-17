import { useEffect, useState } from "react";
import { Button, Select } from "@mantine/core";
import { DateInput } from "@mantine/dates";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import { Project } from "@/types/project";
import { toDateOnly } from "@/utils/helpers/format-date";

export type ForecastFilterValues = {
  from: string;
  to: string;
  granularity: string;
  project: string;
  direction: string;
  status: string;
};

const toDate = (value?: string) => (value ? new Date(`${value}T00:00:00`) : null);
const fromDate = (date: Date | null) => (date ? toDateOnly(date) : "");

const HORIZON_PRESETS = [30, 60, 90, 180];

export default function ForecastFilters({
  values,
  onChange,
  hideProject = false,
}: {
  values: ForecastFilterValues;
  onChange: (values: ForecastFilterValues) => void;
  hideProject?: boolean;
}) {
  const { language, translate } = useLanguage();

  const { privateRequest, data: projects, setData: setProjects } = useDataHandler<Project[]>({ initialData: [] });
  useEffect(() => {
    if (hideProject) return;
    privateRequest({ url: "projects", params: { limit: 500 }, language })
      .then((res) => setProjects(res.data))
      .catch(() => setProjects([]));
  }, []);

  const [customOpen, setCustomOpen] = useState(false);

  function applyHorizon(days: number) {
    const from = new Date();
    const to = new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
    onChange({ ...values, from: toDateOnly(from), to: toDateOnly(to) });
    setCustomOpen(false);
  }

  function set<K extends keyof ForecastFilterValues>(key: K, value: ForecastFilterValues[K]) {
    onChange({ ...values, [key]: value });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {HORIZON_PRESETS.map((days) => (
          <Button key={days} size="xs" variant="light" onClick={() => applyHorizon(days)}>
            {translate(`Next ${days} days`, `القادمة ${days} يوم`)}
          </Button>
        ))}
        <Button size="xs" variant={customOpen ? "filled" : "light"} onClick={() => setCustomOpen((v) => !v)}>
          {translate("Custom range", "فترة مخصصة")}
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {customOpen && (
          <>
            <DateInput
              label={translate("From", "من")}
              value={toDate(values.from)}
              onChange={(d) => set("from", fromDate(d))}
              valueFormat="YYYY-MM-DD"
              w={160}
            />
            <DateInput
              label={translate("To", "إلى")}
              value={toDate(values.to)}
              onChange={(d) => set("to", fromDate(d))}
              valueFormat="YYYY-MM-DD"
              w={160}
            />
          </>
        )}
        <Select
          label={translate("Granularity", "التجميع الزمني")}
          value={values.granularity || null}
          onChange={(v) => set("granularity", v || "")}
          data={[
            { value: "", label: translate("Auto", "تلقائي") },
            { value: "day", label: translate("Daily", "يومي") },
            { value: "week", label: translate("Weekly", "أسبوعي") },
            { value: "month", label: translate("Monthly", "شهري") },
          ]}
          w={140}
        />
        {!hideProject && (
          <Select
            label={translate("Project", "المشروع")}
            placeholder={translate("All projects", "كل المشاريع")}
            value={values.project || null}
            onChange={(v) => set("project", v || "")}
            data={projects.map((p) => ({ value: p._id, label: `${p.projectNumber}${p.name ? ` - ${p.name}` : ""}` }))}
            searchable
            clearable
            w={220}
          />
        )}
        <Select
          label={translate("Direction", "الاتجاه")}
          value={values.direction || null}
          onChange={(v) => set("direction", v || "")}
          data={[
            { value: "", label: translate("Both", "كلاهما") },
            { value: "in", label: translate("Inflows only", "التدفقات الداخلة فقط") },
            { value: "out", label: translate("Outflows only", "التدفقات الخارجة فقط") },
          ]}
          w={160}
        />
        <Select
          label={translate("Status", "الحالة")}
          placeholder={translate("All statuses", "كل الحالات")}
          value={values.status || null}
          onChange={(v) => set("status", v || "")}
          data={[
            { value: "forecast", label: translate("Forecast", "متوقع") },
            { value: "due_soon", label: translate("Due Soon", "يستحق قريباً") },
            { value: "overdue", label: translate("Overdue", "متأخر") },
            { value: "partially_paid", label: translate("Partially Paid", "مدفوع جزئياً") },
            { value: "unscheduled", label: translate("Unscheduled", "غير مجدول") },
          ]}
          clearable
          w={180}
        />
      </div>
    </div>
  );
}
