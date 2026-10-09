import { Link } from "react-router-dom";
import { Pagination, Table } from "@mantine/core";
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

/** One report section: typed columns, rows (group headers / subtotals / totals), totals row and pages. */
export default function ReportTable({
  section,
  onPageChange,
  renderActions,
}: {
  section: ReportSection;
  onPageChange?: (page: number) => void;
  renderActions?: (row: ReportRow) => React.ReactNode;
}) {
  const { language, translate } = useLanguage();
  const isArabic = language === "ar-EG";

  if (section.rows.length === 0 && !section.totals) {
    return <p className="rounded-md border border-dashed p-4 text-center text-sm text-gray-500">{translate("No data for the selected filters.", "لا توجد بيانات للفلاتر المحددة.")}</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      <DataTableContainer>
        <DataTable className="text-sm">
          <Table.Thead className={dataTableHeadClassName}>
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

      {section.pagination && section.pagination.totalPages > 1 && onPageChange && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
          <span>
            {translate(
              `${section.pagination.totalRows} rows - totals include every row`,
              `${section.pagination.totalRows} صف - الإجماليات تشمل كل الصفوف`,
            )}
          </span>
          <Pagination total={section.pagination.totalPages} value={section.pagination.page} onChange={onPageChange} size="sm" />
        </div>
      )}
    </div>
  );
}
