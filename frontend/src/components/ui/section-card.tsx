import { ReactNode } from "react";
import { Link } from "react-router-dom";

// Shared widget shell for dashboard-style sections (docs section "Admin Home / Dashboard") - a
// titled, bordered card with an optional "View all" link, matching the existing Chart of Accounts
// table's container styling (border/radius/background - see components/ui/data-table.tsx's
// DataTableContainer) rather than a new card language.
export default function SectionCard({
  title,
  viewAllTo,
  viewAllLabel,
  action,
  children,
}: {
  title: string;
  viewAllTo?: string;
  viewAllLabel?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-gray-100 bg-white p-4 dark:border-gray-700 dark:bg-gray-800 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">{title}</h3>
        {action}
        {!action && viewAllTo && (
          <Link to={viewAllTo} className="text-xs font-medium text-primary-600 hover:underline dark:text-primary-400">
            {viewAllLabel}
          </Link>
        )}
      </div>
      {children}
    </div>
  );
}
