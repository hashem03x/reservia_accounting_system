import { useEffect, useMemo } from "react";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import { Button, NumberInput, Select, Table } from "@mantine/core";
import { solidIcons } from "@/components/icons";
import { AverageCostLineInput } from "@/types/project";
import { ChartOfAccount } from "@/types/chart-of-account";

// Shared by CreateProjectModal and the Project detail page's edit mode - fetches the eligible
// accounts from the backend (GET accounts/cogs-eligible) rather than implementing any COGS
// eligibility logic itself, so the frontend can never disagree with the backend about which
// accounts qualify (see docs section "COGS account eligibility").
export default function AverageCostEditor({
  lines,
  setLines,
}: {
  lines: AverageCostLineInput[];
  setLines: (lines: AverageCostLineInput[]) => void;
}) {
  const { language, translate, translations } = useLanguage();
  const privateRequest = usePrivateRequest();

  const { data: eligibleAccounts, setData: setEligibleAccounts } = useDataHandler<ChartOfAccount[]>({ initialData: [] });

  useEffect(() => {
    privateRequest({ url: "accounts/cogs-eligible", language })
      .then((res) => setEligibleAccounts(res.data))
      .catch(() => {});
  }, []);

  const selectedAccountIds = useMemo(() => new Set(lines.map((l) => l.account).filter(Boolean)), [lines]);
  const total = useMemo(() => lines.reduce((sum, l) => sum + (Number(l.amount) || 0), 0), [lines]);

  function addLine() {
    setLines([...lines, { account: "", amount: "" }]);
  }

  function removeLine(index: number) {
    setLines(lines.filter((_, i) => i !== index));
  }

  function updateLine(index: number, updates: Partial<AverageCostLineInput>) {
    setLines(lines.map((l, i) => (i === index ? { ...l, ...updates } : l)));
  }

  const noMoreAccountsAvailable = eligibleAccounts.length > 0 && selectedAccountIds.size >= eligibleAccounts.length;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium">{translate("Average Cost", "متوسط التكلفة")}</label>
        <Button
          size="xs"
          variant="light"
          leftSection={<solidIcons.Plus size={14} />}
          onClick={addLine}
          disabled={noMoreAccountsAvailable || eligibleAccounts.length === 0}
        >
          {translate("Add Cost Account", "إضافة حساب تكلفة")}
        </Button>
      </div>

      {eligibleAccounts.length === 0 && (
        <p className="text-xs text-gray-400">
          {translate(
            "No COGS accounts are available yet - create one from the Chart of Accounts with type \"cogs\" first.",
            "لا توجد حسابات تكاليف بضاعة مباعة متاحة بعد - قم بإنشاء حساب من دليل الحسابات بنوع \"cogs\" أولاً."
          )}
        </p>
      )}

      {lines.length > 0 && (
        <Table withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{translate("Cost Account", "حساب التكلفة")}</Table.Th>
              <Table.Th>{translate("Amount", "المبلغ")}</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {lines.map((line, index) => {
              // An account already chosen on another line is excluded here - duplicate prevention
              // at the UI level (the backend independently re-validates this too, see
              // projectModel.js's pre('validate') hook).
              const availableForThisLine = eligibleAccounts.filter((a) => a._id === line.account || !selectedAccountIds.has(a._id));
              return (
                <Table.Tr key={index}>
                  <Table.Td>
                    <Select
                      placeholder={translate("Select account", "اختر حساب")}
                      value={line.account || null}
                      onChange={(value) => updateLine(index, { account: value || "" })}
                      data={availableForThisLine.map((a) => ({ value: a._id, label: `${a.code} - ${a.name}` }))}
                      searchable
                      required
                    />
                  </Table.Td>
                  <Table.Td>
                    <NumberInput
                      placeholder={translate("Amount", "المبلغ")}
                      value={line.amount}
                      onChange={(value) => updateLine(index, { amount: value })}
                      min={0.01}
                      decimalScale={2}
                      required
                    />
                  </Table.Td>
                  <Table.Td>
                    <Button variant="light" color="red" size="xs" onClick={() => removeLine(index)}>
                      {translate("Remove", "حذف")}
                    </Button>
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
          <Table.Tfoot>
            <Table.Tr className="font-bold">
              <Table.Td>{translate("Total Average Cost", "إجمالي متوسط التكلفة")}</Table.Td>
              <Table.Td>
                {total.toLocaleString()} {translations.currency}
              </Table.Td>
              <Table.Td />
            </Table.Tr>
          </Table.Tfoot>
        </Table>
      )}
    </div>
  );
}
