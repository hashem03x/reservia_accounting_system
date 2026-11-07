import { useState } from "react";
import { Badge, Button, NumberInput, Table, Tooltip } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { formatAmount } from "@/utils/helpers/format-amount";
import { DataTable, DataTableContainer, dataTableHeadClassName } from "@/components/ui/data-table";
import { solidIcons } from "@/components/icons";
import { CommercialProject, CommercialRevision } from "@/types/commercial";

// Every BOQ line distinguishes automatic vs. manually-overridden values (source badge) - an
// override is applied on top of the live recalculation without discarding the auto-calculated
// baseline (shown via the "auto: X" tooltip), per the project's own explicit rule.
export default function BoqTab({ project, revision, onChanged }: { project: CommercialProject; revision: CommercialRevision; onChanged: () => void }) {
  const { translate, language } = useLanguage();
  const [overrides, setOverrides] = useState<Record<string, { qty?: number; unitPrice?: number }>>({});
  const { privateRequest, loading, setLoading, error, setError } = useDataHandler<null>({ initialData: null });

  function setOverride(component: string, field: "qty" | "unitPrice", value: number) {
    setOverrides((prev) => ({ ...prev, [component]: { ...prev[component], [field]: value } }));
  }

  function handleSave() {
    handleRequest(language, setLoading, setError, async () => {
      await privateRequest({
        url: `commercial/revisions/${revision._id}`,
        method: "PATCH",
        data: { engineeringInput: revision.engineeringInput, manualOverrides: overrides },
        language,
      });
      setOverrides({});
      onChanged();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <DataTableContainer>
        <DataTable className="min-w-[900px]">
          <Table.Thead className={dataTableHeadClassName}>
            <Table.Tr>
              <Table.Th>{translate("Component", "البند")}</Table.Th>
              <Table.Th>{translate("Description", "الوصف")}</Table.Th>
              <Table.Th>{translate("Unit", "الوحدة")}</Table.Th>
              <Table.Th className="text-right">{translate("Qty", "الكمية")}</Table.Th>
              <Table.Th className="text-right">{translate("Unit Price", "سعر الوحدة")}</Table.Th>
              <Table.Th className="text-right">{translate("Total", "الإجمالي")}</Table.Th>
              <Table.Th>{translate("Source", "المصدر")}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {revision.boqLines.map((line, i) => (
              <Table.Tr key={i}>
                <Table.Td className="font-medium">
                  {line.component}
                  {line.flag && (
                    <Tooltip label={line.flag}>
                      <solidIcons.ExclamationCircle className="ms-1 inline text-amber-500" size={14} />
                    </Tooltip>
                  )}
                </Table.Td>
                <Table.Td className="max-w-[260px] truncate text-xs text-gray-500">{line.description}</Table.Td>
                <Table.Td>{line.unit}</Table.Td>
                <Table.Td className="text-right">
                  <NumberInput size="xs" value={overrides[line.component]?.qty ?? line.qty ?? undefined} onChange={(v) => setOverride(line.component, "qty", v as number)} w={90} />
                </Table.Td>
                <Table.Td className="text-right">
                  <NumberInput size="xs" value={overrides[line.component]?.unitPrice ?? line.unitPrice ?? undefined} onChange={(v) => setOverride(line.component, "unitPrice", v as number)} w={110} />
                </Table.Td>
                <Table.Td className="text-right font-medium">{formatAmount(line.total, project.currency)}</Table.Td>
                <Table.Td>
                  <Badge size="sm" color={line.source === "override" ? "orange" : line.source === "manual" ? "gray" : "teal"} variant="light">
                    {line.source}
                  </Badge>
                  {line.source === "override" && (
                    <div className="mt-0.5 text-[10px] text-gray-400">
                      {translate("auto", "تلقائي")}: {line.autoQty} x {line.autoUnitPrice}
                    </div>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
            <Table.Tr className="font-semibold">
              <Table.Td colSpan={5} className="text-right">{translate("BOQ Total", "إجمالي جدول الكميات")}</Table.Td>
              <Table.Td className="text-right">{formatAmount(revision.boqTotal, project.currency)}</Table.Td>
              <Table.Td />
            </Table.Tr>
          </Table.Tbody>
        </DataTable>
      </DataTableContainer>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button onClick={handleSave} loading={loading} color="teal" disabled={!Object.keys(overrides).length} className="self-start">
        {translate("Save Overrides", "حفظ التعديلات")}
      </Button>
    </div>
  );
}
