import { useEffect, useState } from "react";
import { Badge, Button, Select, Table, Textarea } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { formatDateAndTime } from "@/utils/helpers/date-formaters";
import ErrorAlert from "@/components/ui/error-alert";
import Modal from "@/components/ui/modal";

type YearDoc = {
  year: number;
  status: "closed" | "open";
  profit: number | null;
  history: { action: "closed" | "reopened"; byName: string | null; at: string; note?: string; profit: number | null }[];
};
type Preview = { year: number; profit: number; accounts: { code: string; name: string; type: string; balance: number }[] };

/**
 * ERP CHG-09 - year-end close: the year's revenue and expenses go to Profit of the year and on to
 * Retained Earnings (two closing entries dated 31 December), and the twelve months are locked. A
 * reopen reverses both entries and needs a reason. Backend: services/accounting/yearEndCloseService.js.
 */
export default function YearEndCloseSection({ onChanged }: { onChanged: () => void }) {
  const { language, translate, translations } = useLanguage();
  const thisYear = new Date().getUTCFullYear();
  const [year, setYear] = useState(String(thisYear - 1));
  const list = useDataHandler<YearDoc[]>({ initialData: [] });
  const preview = useDataHandler<Preview | null>({ initialData: null });
  const action = useDataHandler({ initialData: null });
  const [mode, setMode] = useState<"close" | "reopen" | null>(null);
  const [note, setNote] = useState("");

  const load = () =>
    handleRequest(language, list.setLoading, list.setError, async () => {
      const res = await list.privateRequest({ url: "accounting-periods/years", language });
      list.setData(res.data || []);
    });
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doc = list.data.find((d) => d.year === Number(year));
  const closed = doc?.status === "closed";
  const fmt = (n: number) => `${n.toLocaleString()} ${translations.currency}`;

  function openClose() {
    setMode("close");
    setNote("");
    handleRequest(language, preview.setLoading, preview.setError, async () => {
      const res = await preview.privateRequest({ url: `accounting-periods/years/${year}/preview`, language });
      preview.setData(res.data as Preview);
    });
  }

  function submit() {
    handleRequest(language, action.setLoading, action.setError, async () => {
      await action.privateRequest({
        method: "POST",
        url: `accounting-periods/years/${year}/${mode}`,
        data: { note: note || undefined },
        language,
      });
      setMode(null);
      load();
      onChanged();
    });
  }

  return (
    <section className="mb-6 rounded-lg border border-gray-200 p-4 dark:border-gray-700" data-testid="year-end-close">
      <h4 className="mb-1">{translate("Year-end close", "إقفال السنة المالية")}</h4>
      <p className="mb-3 text-xs text-gray-500">
        {translate(
          "Moves the year's revenue and expenses to Profit of the year (20000003) and on to Retained Earnings (20000002) with two entries dated 31 December, then locks every month of the year. The Statement of Profit or Loss still shows the closed year's figures. Reopening reverses both entries and needs a reason.",
          "ينقل إيرادات ومصروفات السنة إلى أرباح العام (20000003) ثم إلى الأرباح المحتجزة (20000002) بقيدين بتاريخ 31 ديسمبر، ثم يقفل كل شهور السنة. تظل قائمة الدخل تعرض أرقام السنة المقفلة. إعادة الفتح تعكس القيدين وتحتاج إلى سبب.",
        )}
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <Select
          label={translate("Year", "السنة")}
          value={year}
          onChange={(v) => v && setYear(v)}
          data={Array.from({ length: 5 }, (_, i) => String(thisYear - i))}
          allowDeselect={false}
          w={120}
        />
        <Badge color={closed ? "red" : "green"} variant="light" size="lg" data-testid="year-status">
          {closed ? translate("Closed", "مقفلة") : translate("Open", "مفتوحة")}
        </Badge>
        {closed ? (
          <Button color="green" variant="light" onClick={() => (setMode("reopen"), setNote(""))} data-testid="year-reopen">
            {translate("Reopen year", "إعادة فتح السنة")}
          </Button>
        ) : (
          <Button color="red" variant="light" onClick={openClose} data-testid="year-close">
            {translate("Close year", "إقفال السنة")}
          </Button>
        )}
      </div>
      {!!doc?.history.length && (
        <div className="mt-3 overflow-x-auto">
          <Table striped miw={520}>
            <Table.Tbody>
              {[...doc.history].reverse().map((h, i) => (
                <Table.Tr key={i}>
                  <Table.Td className="whitespace-nowrap text-xs">{formatDateAndTime(h.at, language)}</Table.Td>
                  <Table.Td className="text-xs">
                    {h.action === "closed" ? translate("Closed", "إقفال") : translate("Reopened", "إعادة فتح")}
                  </Table.Td>
                  <Table.Td className="text-xs">{h.byName || "-"}</Table.Td>
                  <Table.Td className="text-xs">{h.profit !== null ? fmt(h.profit) : "-"}</Table.Td>
                  <Table.Td className="text-xs">{h.note || "-"}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </div>
      )}

      <Modal
        opened={!!mode}
        onClose={() => setMode(null)}
        title={
          mode === "close" ? translate(`Close ${year}`, `إقفال ${year}`) : translate(`Reopen ${year}`, `إعادة فتح ${year}`)
        }
        size="lg"
      >
        <div className="flex flex-col gap-3">
          {mode === "close" && preview.loading && (
            <p className="text-sm text-gray-500">{translate("Calculating...", "جار الحساب...")}</p>
          )}
          {mode === "close" && preview.error && <ErrorAlert error={preview.error} />}
          {mode === "close" && preview.data && (
            <>
              <p className="text-sm" data-testid="year-preview-profit">
                {translate(`Profit of ${year}: `, `أرباح ${year}: `)}
                <b>{fmt(preview.data.profit)}</b>
                {translate(
                  ` - ${preview.data.accounts.length} revenue and expense accounts will be brought to zero.`,
                  ` - سيتم تصفير ${preview.data.accounts.length} حساب إيرادات ومصروفات.`,
                )}
              </p>
              <p className="text-xs text-gray-500">
                {translate("All twelve months of the year are locked afterwards.", "تُقفل كل شهور السنة بعد ذلك.")}
              </p>
            </>
          )}
          <Textarea
            label={
              mode === "reopen"
                ? translate("Reason (required)", "السبب (مطلوب)")
                : translate("Note (optional)", "ملاحظة (اختياري)")
            }
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            autosize
            minRows={2}
            data-testid="year-note"
          />
          {action.error && <ErrorAlert error={action.error} />}
          <Button
            color={mode === "close" ? "red" : "green"}
            loading={action.loading}
            disabled={(mode === "reopen" && note.trim().length < 3) || (mode === "close" && !preview.data)}
            onClick={submit}
            data-testid="year-confirm"
          >
            {mode === "close" ? translate("Close the year", "إقفال السنة") : translate("Reopen the year", "إعادة فتح السنة")}
          </Button>
        </div>
      </Modal>
    </section>
  );
}
