import { ReactNode } from "react";
import { Skeleton } from "@mantine/core";

// Compact financial-summary tile (docs section "KPI Card Design") - mirrors the existing
// SummaryCard pattern already used on the Project detail page (bordered box, label + value, no
// decorative icon required) rather than inventing a new "dashboard KPI card" visual language.
// Icon is optional and only ever shown small/muted, never the focal point of the card.
export default function KpiCard({
  label,
  value,
  subValue,
  icon,
  loading,
}: {
  label: string;
  value: ReactNode;
  subValue?: ReactNode;
  icon?: ReactNode;
  loading?: boolean;
}) {
  if (loading) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-gray-100 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <Skeleton height={12} width="60%" />
        <Skeleton height={22} width="80%" />
        <Skeleton height={10} width="40%" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 rounded-lg border border-gray-100 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</span>
        {icon && <span className="text-gray-400 dark:text-gray-500">{icon}</span>}
      </div>
      <span className="text-xl font-semibold text-gray-800 dark:text-gray-100">{value}</span>
      {subValue != null && <span className="text-xs text-gray-500 dark:text-gray-400">{subValue}</span>}
    </div>
  );
}
