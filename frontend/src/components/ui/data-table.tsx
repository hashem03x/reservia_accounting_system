import { ReactNode, useEffect, useRef, useState } from "react";
import { Table, TableProps } from "@mantine/core";

// The shared table visual system - first established on the Chart of Accounts table (see
// pages/admin/accounts/index.tsx) and reused everywhere else a dense data table is needed
// (Projects, Journal Entries/General Ledger, Advanced Payments - docs section "Chart of Accounts
// as the shared table style"). Each page keeps its own columns/rows/data entirely - only the
// container and table-level presentation live here, so a future visual change to this one spot
// applies everywhere consistently instead of needing to be repeated per page.

// Horizontal-scroll UX: a wide table's native scrollbar sits at the bottom of the (possibly very
// tall) scroll container, so a user must scroll all the way down the table before reaching it.
// This renders a second, thin scrollbar directly ABOVE the table - reachable the instant the
// table appears - kept in sync with the real one in both directions via scrollLeft mirroring. A
// `syncing` ref (not state) breaks the mirror-feedback loop: each scroll handler sets the OTHER
// element's scrollLeft, which would otherwise re-fire that element's own onScroll.
function useSyncedHorizontalScroll() {
  const topRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const syncing = useRef(false);
  const [scrollWidth, setScrollWidth] = useState(0);
  const [hasOverflow, setHasOverflow] = useState(false);

  useEffect(() => {
    const bottomEl = bottomRef.current;
    if (!bottomEl) return;

    const updateWidth = () => {
      setScrollWidth(bottomEl.scrollWidth);
      setHasOverflow(bottomEl.scrollWidth > bottomEl.clientWidth);
    };
    updateWidth();

    const resizeObserver = new ResizeObserver(updateWidth);
    resizeObserver.observe(bottomEl);
    const mutationObserver = new MutationObserver(updateWidth);
    mutationObserver.observe(bottomEl, { childList: true, subtree: true });

    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, []);

  function mirror(source: HTMLDivElement, target: HTMLDivElement) {
    if (syncing.current) return;
    syncing.current = true;
    target.scrollLeft = source.scrollLeft;
    syncing.current = false;
  }

  return {
    topRef,
    bottomRef,
    scrollWidth,
    hasOverflow,
    onTopScroll: () => {
      if (topRef.current && bottomRef.current) mirror(topRef.current, bottomRef.current);
    },
    onBottomScroll: () => {
      if (topRef.current && bottomRef.current) mirror(bottomRef.current, topRef.current);
    },
  };
}

// The two-div scroll wrapper: horizontal overflow is contained to this card only (never the page
// body), matching the convention already used throughout the app (e.g. the PO/SO payment history
// tables) - see truncated-text.tsx's sibling usage on the Accounts page for why this matters.
export function DataTableContainer({ children }: { children: ReactNode }) {
  const { topRef, bottomRef, scrollWidth, hasOverflow, onTopScroll, onBottomScroll } = useSyncedHorizontalScroll();

  return (
    <div className="overflow-hidden rounded-lg border border-gray-100">
      {hasOverflow && (
        <div ref={topRef} onScroll={onTopScroll} className="overflow-x-auto overflow-y-hidden" style={{ height: 14 }}>
          <div style={{ width: scrollWidth, height: 1 }} />
        </div>
      )}
      <div ref={bottomRef} onScroll={onBottomScroll} className="overflow-x-auto">
        {children}
      </div>
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
