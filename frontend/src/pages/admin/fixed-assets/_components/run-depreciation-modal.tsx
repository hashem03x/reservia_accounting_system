import { useEffect, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import handleRequest from "@/utils/helpers/handle-request";
import { toMonthOnly } from "@/utils/helpers/format-date";
import { formatAmount } from "@/utils/helpers/format-amount";
import { Alert, Button, Table } from "@mantine/core";
import { MonthPickerInput } from "@mantine/dates";
import ErrorAlert from "@/components/ui/error-alert";
import Modal from "@/components/ui/modal";
import JournalEntryLink from "@/components/global/journal-entry-link";
import { DepreciationRunResult } from "@/types/fixed-asset";
import { DepreciationRunRecord } from "@/types/purchase-order-extras";

// Manual monthly depreciation/amortization run: every active asset not yet depreciated for the
// chosen month gets one entry (Dr Depreciation & Amortization / Cr Accumulated) - all or nothing.
export default function RunDepreciationModal({
  opened,
  close,
  onCompleted,
}: {
  opened: boolean;
  close: () => void;
  onCompleted: () => void;
}) {
  const { language, translate, translations } = useLanguage();
  const privateRequest = usePrivateRequest();

  const [month, setMonth] = useState<Date | null>(new Date());
  const [result, setResult] = useState<DepreciationRunResult | null>(null);
  const { loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  function handleRun(e: React.FormEvent) {
    e.preventDefault();
    if (!month) return;
    if (!confirm(translate(`Run depreciation for ${toMonthOnly(month)}?`, `تشغيل الإهلاك لشهر ${toMonthOnly(month)}؟`)))
      return;
    handleRequest(language, setLoading, setError, async () => {
      const res = await privateRequest({
        language,
        method: "POST",
        url: "fixed-assets/depreciation/run",
        data: { period: toMonthOnly(month) },
      });
      setResult(res.data);
      onCompleted();
    });
  }

  function handleClose() {
    close();
    setTimeout(() => {
      setResult(null);
      setMonth(new Date());
      setError("");
    }, 250);
  }

  return (
    <Modal opened={opened} onClose={handleClose} title={translate("Run Depreciation", "تشغيل الإهلاك")} size="lg">
      <form onSubmit={handleRun} className="flex flex-col gap-4">
        {error && <ErrorAlert error={error} />}

        <MonthPickerInput
          label={translate("Depreciation Month", "شهر الإهلاك")}
          description={translate(
            "Each active asset is depreciated once per month: cost / useful life in months, never below a Book Value of 0.",
            "يُهلك كل أصل نشط مرة واحدة في الشهر: التكلفة / العمر الإنتاجي بالشهور، ولا تقل القيمة الدفترية عن صفر.",
          )}
          value={month}
          onChange={(value) => {
            setMonth(value);
            setResult(null);
          }}
          maxDate={new Date()}
          required
        />

        <Button type="submit" color="grape" loading={loading} disabled={!month}>
          {translate("Run", "تشغيل")}
        </Button>
      </form>

      {result && (
        <div className="mt-5 flex flex-col gap-3">
          {result.processed.length === 0 ? (
            <Alert color="gray">
              {translate(
                `Nothing to depreciate for ${result.period} - every eligible asset is already depreciated for this month.`,
                `لا يوجد ما يُهلك لشهر ${result.period} - تم إهلاك كل الأصول المؤهلة لهذا الشهر بالفعل.`,
              )}
            </Alert>
          ) : (
            <>
              <Alert color="green">
                {translate(
                  `${result.processed.length} asset(s) depreciated for ${result.period}: ${formatAmount(result.totalAmount, translations.currency)}`,
                  `تم إهلاك ${result.processed.length} أصل لشهر ${result.period}: ${formatAmount(result.totalAmount, translations.currency)}`,
                )}
              </Alert>
              <Table striped>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{translate("Asset", "الأصل")}</Table.Th>
                    <Table.Th className="text-right">{translate("Amount", "المبلغ")}</Table.Th>
                    <Table.Th className="text-right">{translate("Book Value", "القيمة الدفترية")}</Table.Th>
                    <Table.Th>{translate("Journal Entry", "القيد")}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {result.processed.map((row) => (
                    <Table.Tr key={row.asset}>
                      <Table.Td>{row.name}</Table.Td>
                      <Table.Td className="text-right tabular-nums">
                        {formatAmount(row.amount, translations.currency)}
                      </Table.Td>
                      <Table.Td className="text-right tabular-nums">
                        {formatAmount(row.bookValue, translations.currency)}
                      </Table.Td>
                      <Table.Td>
                        <JournalEntryLink entry={{ _id: row.journalEntry, entryNumber: row.entryNumber }} />
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </>
          )}
          {!!result.missingEarlierMonths?.length && (
            <Alert color="yellow" title={translate("Earlier months not yet depreciated", "شهور سابقة لم تُهلك بعد")}>
              <p className="mb-1 text-sm">
                {translate(
                  "Each month is its own run. Run these months as well so the accumulated depreciation is complete:",
                  "كل شهر له تشغيل مستقل. شغّل هذه الشهور أيضاً ليكتمل مجمع الإهلاك:",
                )}
              </p>
              <ul className="list-disc ps-5 text-sm">
                {result.missingEarlierMonths.map((m) => (
                  <li key={m.asset}>
                    {m.name}: {m.periods.join(", ")}
                  </li>
                ))}
              </ul>
            </Alert>
          )}
          {!!result.skipped?.length && (
            <div className="flex flex-col gap-1">
              <h5 className="text-sm font-semibold">{translate("Not depreciated this month", "لم يُهلك هذا الشهر")}</h5>
              <ul className="list-disc ps-5 text-sm text-gray-600 dark:text-gray-300">
                {result.skipped.map((s) => (
                  <li key={s.asset}>
                    {s.name}: {s.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      <RunHistory refreshKey={result?.run || ""} />
    </Modal>
  );
}

// The latest depreciation runs (audit trail): month, assets depreciated, total, by whom.
function RunHistory({ refreshKey }: { refreshKey: string }) {
  const { language, translate, translations } = useLanguage();
  const privateRequest = usePrivateRequest();
  const [runs, setRuns] = useState<DepreciationRunRecord[]>([]);
  useEffect(() => {
    privateRequest({ url: "fixed-assets/depreciation/runs", language })
      .then((res) => setRuns((res.data || []).slice(0, 10)))
      .catch(() => setRuns([]));
  }, [refreshKey]);
  if (!runs.length) return null;
  return (
    <div className="mt-5 flex flex-col gap-2">
      <h5 className="text-sm font-semibold">{translate("Recent runs", "آخر التشغيلات")}</h5>
      <Table className="text-sm" withColumnBorders>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{translate("Month", "الشهر")}</Table.Th>
            <Table.Th>{translate("Run at", "وقت التشغيل")}</Table.Th>
            <Table.Th className="text-end">{translate("Depreciated", "تم إهلاكها")}</Table.Th>
            <Table.Th className="text-end">{translate("Not depreciated", "لم تُهلك")}</Table.Th>
            <Table.Th className="text-end">{translate("Total", "الإجمالي")}</Table.Th>
            <Table.Th>{translate("By", "بواسطة")}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {runs.map((r) => (
            <Table.Tr key={r._id}>
              <Table.Td className="tabular-nums">{r.period}</Table.Td>
              <Table.Td className="whitespace-nowrap">{new Date(r.createdAt).toLocaleString(language)}</Table.Td>
              <Table.Td className="text-end tabular-nums">{r.processed.length}</Table.Td>
              <Table.Td className="text-end tabular-nums" title={r.skipped.map((s) => `${s.name}: ${s.reason}`).join("; ")}>
                {r.skipped.length}
              </Table.Td>
              <Table.Td className="text-end tabular-nums">{formatAmount(r.totalAmount, translations.currency)}</Table.Td>
              <Table.Td>{r.createdBy?.name || "-"}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </div>
  );
}
