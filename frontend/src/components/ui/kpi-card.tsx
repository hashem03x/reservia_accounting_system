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
      <div className="flex min-h-[104px] min-w-0 flex-col gap-2 rounded-lg border border-gray-100 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <Skeleton height={12} width="60%" />
        <Skeleton height={22} width="80%" />
        <Skeleton height={10} width="40%" />
      </div>
    );
  }

  return (
    // `min-w-0` is required here because this card is a CSS grid item (see kpi-section.tsx) - a
    // grid item's default min-width is `auto`, which lets an unbreakable long token (e.g. a
    // formatted currency string - Intl.NumberFormat joins the currency code to the amount with a
    // NON-BREAKING space, so "EGP 2,100,000.00" is one unbreakable run) force the grid column
    // itself to grow past its intended width instead of wrapping/shrinking - the actual cause of
    // the KPI value overflowing its card. `min-h-[104px]` keeps every card in a row the same
    // height even when one card's description wraps to two lines (docs section "Card Height").
    <div className="flex min-h-[104px] min-w-0 flex-col gap-1 rounded-lg border border-gray-100 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</span>
        {icon && <span className="shrink-0 text-gray-400 dark:text-gray-500">{icon}</span>}
      </div>
      {/* `break-words` is the safety net for an exceptionally long value on an exceptionally
          narrow card (e.g. "EGP 10,000,000,000.00" on a mobile single-column layout) - normally
          the card is wide enough and this never triggers, but it guarantees the value can never
          force horizontal overflow even in that edge case, rather than being clipped or spilling
          out. `text-lg sm:text-xl` is the one responsive-typography step requested - a modest,
          still-prominent reduction, never shrunk down to an unreadable size. */}
      <span className="min-w-0 break-words text-lg font-semibold text-gray-800 dark:text-gray-100 sm:text-xl">{value}</span>
      {subValue != null && <span className="text-xs text-gray-500 dark:text-gray-400">{subValue}</span>}
    </div>
  );
}
