import { Link } from "react-router-dom";
import { Pagination, Select, Table } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import { DataTable, DataTableContainer, dataTableHeadClassName } from "@/components/ui/data-table";
import { ReportColumn, ReportRow, ReportSection } from "@/types/accounting-report";
import { formatCell, isFigure, linkOf } from "./format";

const rowClass: Record<string, string> = {
  header: "bg-gray-50 font-semibold text-gray-800",
  subtotal: "font-semibold",
  total: "font-bold",
  muted: "text-gray-500 italic",
};

function Cell({ column, row, isArabic }: { column: ReportColumn; row: ReportRow; isArabic: boolean }) {
  const text = formatCell(column, row, isArabic);
  const href = linkOf(row, column.key);
  const negative = column.type === "money" && typeof row[column.key] === "number" && (row[column.key] as number) < 0;
  const align = isFigure(column) ? "whitespace-nowrap text-end tabular-nums" : column.type === "longtext" ? "min-w-[260px] whitespace-pre-wrap" : "max-w-[280px]";
  return (
    <Table.Td className={`${align} ${negative ? "text-red-600" : ""}`}>
      {href ? (
        <Link to={href} className="text-blue-600 hover:underline">
          {text}
        </Link>
      ) : column.type === "longtext" || isFigure(column) ? (
        text
      ) : (
        <span className="block truncate" title={text}>
          {text}
        </span>
      )}
    </Table.Td>
  );
}

// Rows per page a paginated section can be viewed with (the backend caps pageSize at 1000 -
// accountingReportsController.js#PAGE_SIZE_MAX; its default is 100).
export const REPORT_PAGE_SIZES = ["50", "100", "250", "500", "1000"];

/** Page navigation for a paginated section: rows shown, rows per page, first/previous/next/last. */
function SectionPager({
  pagination,
  onPageChange,
  onPageSizeChange,
}: {
  pagination: NonNullable<ReportSection["pagination"]>;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
}) {
  const { translate } = useLanguage();
  const { page, pageSize, totalRows, totalPages } = pagination;
  const from = totalRows === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalRows);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
      <span>
        {translate(
          `Rows ${from.toLocaleString()}-${to.toLocaleString()} of ${totalRows.toLocaleString()} - totals include every row`,
          `الصفوف ${from.toLocaleString()}-${to.toLocaleString()} من ${totalRows.toLocaleString()} - الإجماليات تشمل كل الصفوف`,
        )}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        {onPageSizeChange && (
          <Select
            size="xs"
            w={120}
            aria-label={translate("Rows per page", "عدد الصفوف في الصفحة")}
            value={String(pageSize)}
            onChange={(v) => v && onPageSizeChange(Number(v))}
            data={REPORT_PAGE_SIZES.map((s) => ({ value: s, label: translate(`${s} / page`, `${s} / صفحة`) }))}
            allowDeselect={false}
          />
        )}
        {totalPages > 1 && <Pagination total={totalPages} value={page} onChange={onPageChange} size="sm" withEdges />}
      </div>
    </div>
  );
}

/** One report section: typed columns, rows (group headers / subtotals / totals), totals row and pages. */
export default function ReportTable({
  section,
  onPageChange,
  onPageSizeChange,
  renderActions,
}: {
  section: ReportSection;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  renderActions?: (row: ReportRow) => React.ReactNode;
}) {
  const { language, translate } = useLanguage();
  const isArabic = language === "ar-EG";
  // Navigation is shown above the table too (a long ledger page should not need scrolling to the
  // end to change page), and whenever the section is paginated - even on a single page, so the
  // rows-per-page choice stays reachable.
  const pager =
    section.pagination && onPageChange ? (
      <SectionPager pagination={section.pagination} onPageChange={onPageChange} onPageSizeChange={onPageSizeChange} />
    ) : null;

  if (section.rows.length === 0 && !section.totals) {
    return <p className="rounded-md border border-dashed p-4 text-center text-sm text-gray-500">{translate("No data for the selected filters.", "لا توجد بيانات للفلاتر المحددة.")}</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {pager}
      {/* Bounded height: the table scrolls inside its card, so the header stays frozen (stickyHeader)
          and the horizontal scrollbars (top and bottom) are always on screen. */}
      <DataTableContainer maxHeight="70vh">
        <DataTable className="text-sm" stickyHeader>
          <Table.Thead className={`${dataTableHeadClassName} z-10 shadow-[0_1px_0_0_rgba(0,0,0,0.08)]`}>
            <Table.Tr>
              {section.columns.map((c) => (
                <Table.Th key={c.key} className={isFigure(c) ? "whitespace-nowrap text-end" : "whitespace-nowrap"}>
                  {isArabic ? c.label.ar : c.label.en}
                </Table.Th>
              ))}
              {renderActions && <Table.Th />}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {section.rows.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={section.columns.length + (renderActions ? 1 : 0)} className="text-center text-gray-500">
                  {translate("No data for the selected filters.", "لا توجد بيانات للفلاتر المحددة.")}
                </Table.Td>
              </Table.Tr>
            )}
            {section.rows.map((row, i) =>
              row._rowType === "header" ? (
                <Table.Tr key={i} className={rowClass.header}>
                  <Table.Td colSpan={section.columns.length + (renderActions ? 1 : 0)}>{String((isArabic ? row.nameAr : null) ?? row.name ?? "")}</Table.Td>
                </Table.Tr>
              ) : (
                <Table.Tr key={i} className={rowClass[row._rowType || ""] || ""}>
                  {section.columns.map((c) => (
                    <Cell key={c.key} column={c} row={row} isArabic={isArabic} />
                  ))}
                  {renderActions && <Table.Td className="whitespace-nowrap">{renderActions(row)}</Table.Td>}
                </Table.Tr>
              ),
            )}
          </Table.Tbody>
          {section.totals && (
            <Table.Tfoot className="border-t-2 bg-gray-50 font-bold">
              <Table.Tr>
                {section.columns.map((c) => (
                  <Cell key={c.key} column={c} row={section.totals as ReportRow} isArabic={isArabic} />
                ))}
                {renderActions && <Table.Td />}
              </Table.Tr>
            </Table.Tfoot>
          )}
        </DataTable>
      </DataTableContainer>

      {pager}
    </div>
  );
}
