import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import useHasPermission from "@/hooks/useHasPermission";
import { Alert, Badge, Button, Table } from "@mantine/core";
import { DateInput } from "@mantine/dates";
import LoadingSection from "@/components/ui/sections/loading";
import EmptySection from "@/components/ui/sections/empty";
import ErrorAlert from "@/components/ui/error-alert";
import { formatAmount } from "@/utils/helpers/format-amount";
import resources from "@/utils/constants/resources";
import actions from "@/utils/constants/actions";
import paths from "@/utils/constants/paths";

type AccountRef = { _id: string; code: string; name: string };
type AdjustmentLine = {
  pucAccount: AccountRef;
  costAccount: AccountRef;
  balance: number;
  debit: { account: string; amount: number };
  credit: { account: string; amount: number };
};
type AdjustmentPreview = {
  completed: boolean;
  lines: AdjustmentLine[];
  unmapped: { pucAccount: AccountRef; balance: number }[];
  pendingDraft: { _id: string; entryNumber: number } | null;
};

// The end-of-project PUC cost adjustment: what is left in each PUC account of the project after
// revenue/cost recognition, and the entry that clears it against the matching cost of sales account.
// Viewing it posts nothing; the button only creates a DRAFT journal entry for review and posting.
export default function ProjectCostAdjustmentSection({ projectId }: { projectId: string }) {
  const { language, translate, translations } = useLanguage();
  const privateRequest = usePrivateRequest();
  const canCreate = useHasPermission(resources.journalEntries, actions.create);

  const [preview, setPreview] = useState<AdjustmentPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [date, setDate] = useState<Date | null>(new Date());
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await privateRequest({ url: `projects/${projectId}/cost-adjustment`, language });
      setPreview(res.data);
    } catch (err) {
      setError((err as Error)?.message || translate("Failed to load the cost adjustment.", "فشل تحميل تسوية التكلفة."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [projectId]);

  async function handleCreate() {
    setCreating(true);
    setCreateError("");
    try {
      await privateRequest({
        url: `projects/${projectId}/cost-adjustment`,
        method: "POST",
        data: { date: date ? date.toISOString() : undefined },
        language,
      });
      await load();
    } catch (err) {
      setCreateError((err as Error)?.message || translate("Failed to create the draft.", "فشل إنشاء المسودة."));
    } finally {
      setCreating(false);
    }
  }

  const accountLabel = (a: AccountRef) => `${a.code} - ${a.name}`;
  const nameOf = (line: AdjustmentLine, id: string) =>
    id === line.costAccount._id ? accountLabel(line.costAccount) : accountLabel(line.pucAccount);

  return (
    <div className="mt-6 flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4>{translate("PUC Cost Adjustment", "تسوية تكلفة مشروعات تحت التنفيذ")}</h4>
        <Link
          className="text-sm text-blue-600 hover:underline dark:text-blue-400"
          to={`/${paths.admin}/${paths.financialReports}/puc-estimates?project=${projectId}`}
        >
          {translate("PUC - Estimated vs Actual report", "تقرير التكلفة التقديرية مقابل الفعلية")}
        </Link>
      </div>

      {loading ? (
        <LoadingSection message={translate("Calculating PUC balances...", "جاري حساب الأرصدة...")} />
      ) : error ? (
        <ErrorAlert error={error} />
      ) : !preview ? null : (
        <>
          {preview.pendingDraft && (
            <Alert color="yellow">
              {translate("A cost adjustment draft is waiting to be posted: ", "توجد مسودة تسوية بانتظار الترحيل: ")}
              <Link
                className="font-semibold underline"
                to={`/${paths.admin}/${paths.journalEntries}/${preview.pendingDraft._id}`}
              >
                {translate("Entry", "قيد")} #{preview.pendingDraft.entryNumber}
              </Link>
            </Alert>
          )}
          {preview.lines.length === 0 && preview.unmapped.length === 0 ? (
            <EmptySection message={translate("No PUC balance left to adjust", "لا توجد أرصدة متبقية للتسوية")} />
          ) : (
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{translate("PUC Account", "حساب تحت التنفيذ")}</Table.Th>
                  <Table.Th>{translate("Balance", "الرصيد")}</Table.Th>
                  <Table.Th>{translate("Debit", "مدين")}</Table.Th>
                  <Table.Th>{translate("Credit", "دائن")}</Table.Th>
                  <Table.Th>{translate("Amount", "المبلغ")}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {preview.lines.map((line) => (
                  <Table.Tr key={line.pucAccount._id}>
                    <Table.Td>{accountLabel(line.pucAccount)}</Table.Td>
                    <Table.Td className={line.balance < 0 ? "text-red-600 dark:text-red-400" : undefined}>
                      {formatAmount(line.balance, translations.currency)}
                    </Table.Td>
                    <Table.Td>{nameOf(line, line.debit.account)}</Table.Td>
                    <Table.Td>{nameOf(line, line.credit.account)}</Table.Td>
                    <Table.Td>{formatAmount(line.debit.amount, translations.currency)}</Table.Td>
                  </Table.Tr>
                ))}
                {preview.unmapped.map((u) => (
                  <Table.Tr key={u.pucAccount._id}>
                    <Table.Td>{accountLabel(u.pucAccount)}</Table.Td>
                    <Table.Td>{formatAmount(u.balance, translations.currency)}</Table.Td>
                    <Table.Td colSpan={3}>
                      <Badge color="orange" variant="light">
                        {translate("No matching cost account - adjust manually", "لا يوجد حساب تكلفة مقابل - سوِّ يدويًا")}
                      </Badge>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}

          {preview.lines.length > 0 && !preview.pendingDraft && (
            <div className="flex flex-col gap-2">
              {!preview.completed ? (
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  {translate(
                    "The adjustment is prepared once the project is completed.",
                    "تُعد التسوية عند اكتمال المشروع.",
                  )}
                </span>
              ) : (
                canCreate && (
                  <div className="flex flex-wrap items-end gap-2">
                    <DateInput
                      label={translate("Entry date", "تاريخ القيد")}
                      value={date}
                      onChange={setDate}
                      valueFormat="YYYY-MM-DD"
                    />
                    <Button onClick={handleCreate} loading={creating} disabled={!date}>
                      {translate("Create draft journal entry", "إنشاء قيد مسودة")}
                    </Button>
                  </div>
                )
              )}
              {createError && <ErrorAlert error={createError} />}
            </div>
          )}
        </>
      )}
    </div>
  );
}
