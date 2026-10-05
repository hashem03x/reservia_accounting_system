import { ReactNode } from "react";
import { Table, TableProps } from "@mantine/core";

// The shared table visual system - first established on the Chart of Accounts table (see
// pages/admin/accounts/index.tsx) and reused everywhere else a dense data table is needed
// (Projects, Journal Entries/General Ledger, Advanced Payments - docs section "Chart of Accounts
// as the shared table style"). Each page keeps its own columns/rows/data entirely - only the
// container and table-level presentation live here, so a future visual change to this one spot
// applies everywhere consistently instead of needing to be repeated per page.

// The two-div scroll wrapper: horizontal overflow is contained to this card only (never the page
// body), matching the convention already used throughout the app (e.g. the PO/SO payment history
// tables) - see truncated-text.tsx's sibling usage on the Accounts page for why this matters.
export function DataTableContainer({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-lg border border-gray-100">
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

// Thin preset over Mantine's own Table - striped/highlightOnHover/verticalSpacing/withColumnBorders
// and the compact text-sm size are what the Chart of Accounts table established; callers only ever
// need to add their own min-width (e.g. `className="min-w-[960px]"`) for a wide table.
export function DataTable({ children, className = "", ...props }: TableProps) {
  return (
    <Table striped highlightOnHover verticalSpacing="sm" withColumnBorders className={`text-sm ${className}`} {...props}>
      {children}
    </Table>
  );
}

// Apply to every DataTable's <Table.Thead> - matches Chart of Accounts' header treatment exactly.
export const dataTableHeadClassName = "bg-gray-50 text-gray-700";
