import { useState } from "react";
import { Badge, Checkbox, SegmentedControl, Table } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import type { PreviewRow } from "./types";

export const ROW_STATUS_COLOR: Record<string, string> = { Update: "blue", New: "grape", Unchanged: "gray", Error: "red" };

/** A price exactly as imported - decimals kept (46.5 stays 46.50, never rounded to 47). */
export const money = (v: number | null | undefined) => (v == null ? "-" : v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

/**
 * The rows of one supplier price list - the preview before Confirm, and the stored rows of an
 * earlier upload (View). Each row shows the supplier, the price as quoted (with its currency), the
 * EGP price the Price Book uses, and - for a row that could not be imported - why, so a missing or
 * invalid price is identifiable instead of a blank value.
 */
export default function PriceListRows({
  rows,
  supplierLabel,
  createNew,
  onToggleCreate,
  testId,
}: {
  rows: PreviewRow[];
  supplierLabel: string;
  createNew?: number[];
  onToggleCreate?: (rowNo: number, checked: boolean) => void;
  testId?: string;
}) {
  const { translate } = useLanguage();
  const [filter, setFilter] = useState<"all" | "errors">("all");
  const errors = rows.filter((r) => r.status === "Error").length;
  const shown = filter === "errors" ? rows.filter((r) => r.status === "Error") : rows;
  return (
    <div className="flex flex-col gap-2">
      {errors > 0 && (
        <SegmentedControl
          size="xs"
          className="self-start"
          value={filter}
          onChange={(v) => setFilter(v as "all" | "errors")}
          data={[
            { value: "all", label: translate(`All rows (${rows.length})`, `كل الصفوف (${rows.length})`) },
            { value: "errors", label: translate(`Rows with errors (${errors})`, `صفوف بها أخطاء (${errors})`) },
          ]}
        />
      )}
      <div className="max-h-[420px] overflow-auto">
        <Table striped stickyHeader fz="xs" miw={1100} data-testid={testId}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{translate("Row", "الصف")}</Table.Th>
              <Table.Th>{translate("Item (brand | model | spec)", "الصنف")}</Table.Th>
              <Table.Th>{translate("Supplier", "المورد")}</Table.Th>
              <Table.Th className="text-right">{translate("Unit price (as quoted)", "سعر الوحدة (كما ورد)")}</Table.Th>
              <Table.Th className="text-right">{translate("Unit price (EGP)", "سعر الوحدة (جنيه)")}</Table.Th>
              <Table.Th className="text-right">{translate("Current (EGP)", "الحالي")}</Table.Th>
              <Table.Th>{translate("Change", "التغير")}</Table.Th>
              <Table.Th>{translate("Rated", "القيمة المقننة")}</Table.Th>
              <Table.Th>{translate("Availability", "التوفر")}</Table.Th>
              <Table.Th>{translate("Status", "الحالة")}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {shown.map((r) => (
              <Table.Tr key={r.rowNo} data-testid="price-list-row" className={r.status === "Error" ? "bg-red-50" : ""}>
                <Table.Td>{r.rowNo}</Table.Td>
                <Table.Td>
                  <div>{r.key}</div>
                  <div className="text-[10px] text-gray-500">
                    {r.category}
                    {r.unit ? ` · ${r.unit}` : ""}
                  </div>
                </Table.Td>
                <Table.Td>{supplierLabel}</Table.Td>
                <Table.Td className="text-right" data-testid="price-list-row-price">
                  {r.price != null ? `${money(r.price)} ${r.currency}` : <span className="text-red-600">{translate("no price", "بدون سعر")}</span>}
                </Table.Td>
                <Table.Td className="text-right font-medium" data-testid="price-list-row-egp">
                  {money(r.egp)}
                  {r.currency !== "EGP" && r.fxRate ? <div className="text-[10px] text-gray-500">x {r.fxRate}</div> : null}
                </Table.Td>
                <Table.Td className="text-right">{money(r.current)}</Table.Td>
                <Table.Td className={r.changePct != null && r.changePct > 0 ? "text-red-600" : "text-teal-700"}>{r.changePct != null ? `${r.changePct > 0 ? "+" : ""}${r.changePct}%` : "-"}</Table.Td>
                <Table.Td>{r.ratedValue != null ? `${r.ratedValue} ${r.ratedUnit || ""}` : "-"}</Table.Td>
                <Table.Td>
                  {r.availability}
                  {r.leadTimeDays ? ` (${r.leadTimeDays} d)` : ""}
                </Table.Td>
                <Table.Td>
                  <div className="flex items-center gap-1">
                    <Badge color={ROW_STATUS_COLOR[r.status]} variant="light" size="sm">
                      {r.status}
                    </Badge>
                    {r.status === "New" && onToggleCreate && (
                      <Checkbox size="xs" label={translate("create", "إنشاء")} checked={!!createNew?.includes(r.rowNo)} onChange={(e) => onToggleCreate(r.rowNo, e.currentTarget.checked)} />
                    )}
                  </div>
                  {r.errors.length > 0 && (
                    <div className="text-[10px] text-red-600" data-testid="price-list-row-errors">
                      {r.errors.join("; ")}
                    </div>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </div>
    </div>
  );
}
